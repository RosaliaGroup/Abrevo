'use strict';
/**
 * Telnyx webhook processing (inbound messages + delivery status). Signature
 * verification happens in the HTTP handlers; this module is pure logic over
 * injected { repo, conversationService, clock } and is fully idempotent.
 *
 * Inbound: normalize sender -> find/create conversation -> persist the inbound
 * message ONCE (unique on provider message id) -> update recency -> apply
 * STOP/START/HELP to opt-out state. Never creates a duplicate CRM record.
 *
 * Delivery: find the outbound message by provider message id -> update status
 * idempotently (monotonic; out-of-order and duplicate events are ignored) ->
 * unmatched events are reported, never turned into fake messages.
 */

const { classifyKeyword, REPLIES } = require('./compliance');
const { createLeadLinker } = require('./leadLinker');

function isUnique(err) {
  return err && (err.name === 'UniqueViolationError' || err.code === 'unique_violation');
}

// Delivery status precedence (monotonic). failed and delivered are terminal.
const RANK = { queued: 1, sent: 2, delivered: 3, failed: 3 };

function createSmsWebhookProcessor({ repo, conversationService, clock, leadLinker } = {}) {
  if (!repo || !conversationService) throw new Error('createSmsWebhookProcessor: repo + conversationService required');
  const now = clock || (() => new Date().toISOString());
  // Phase 2A-1: inbound → unique-Rosalia-lead auto-linker. Injectable for tests;
  // in production it reads Rosalia's line from env. Never throws or sends.
  const linker = leadLinker || createLeadLinker({ repo, rosaliaNumber: process.env.TELNYX_FROM_ROSALIA });

  function extractInbound(event) {
    const p = (event && event.data && event.data.payload) || {};
    const from = p.from && p.from.phone_number;
    const to = Array.isArray(p.to) && p.to[0] && p.to[0].phone_number;
    return { providerMessageId: p.id || (event.data && event.data.id) || null, from, to, text: p.text != null ? p.text : '' };
  }

  function mapDeliveryStatus(event) {
    const et = event && event.data && event.data.event_type;
    const p = (event && event.data && event.data.payload) || {};
    const toStatuses = Array.isArray(p.to) ? p.to.map((t) => String(t.status || '').toLowerCase()) : [];
    if (et === 'message.delivery_failed') return 'failed';
    if (et === 'message.sent') return 'sent';
    if (et === 'message.finalized') {
      if (toStatuses.some((s) => s === 'delivered')) return 'delivered';
      if (toStatuses.some((s) => s === 'delivery_failed' || s === 'failed')) return 'failed';
      return 'sent';
    }
    // Fallback: infer from the to[].status if present.
    if (toStatuses.some((s) => s === 'delivered')) return 'delivered';
    if (toStatuses.some((s) => s === 'delivery_failed' || s === 'failed')) return 'failed';
    if (toStatuses.some((s) => s === 'sent')) return 'sent';
    return null;
  }

  async function processInbound(event) {
    const { providerMessageId, from, to, text } = extractInbound(event);
    if (!providerMessageId) return { ok: false, reason: 'no_provider_message_id' };

    const conv = await conversationService.getOrCreateConversation({ phone: from, createdBy: 'inbound-webhook' });
    if (!conv.ok) return { ok: false, reason: conv.reason }; // invalid/missing sender — logged by handler, no message

    // Persist the inbound message exactly once.
    let message;
    let deduped = false;
    try {
      message = await repo.insertMessage({
        conversation_id: conv.conversation.id,
        direction: 'inbound',
        body: text,
        status: 'received',
        provider: 'telnyx',
        provider_message_id: providerMessageId,
        received_at: now(),
        created_at: now(),
      });
    } catch (e) {
      if (isUnique(e)) {
        deduped = true;
        message = await repo.getMessageByProviderId('telnyx', providerMessageId);
      } else {
        throw e;
      }
    }

    // Apply compliance BEFORE any future outbound is permitted.
    const keyword = classifyKeyword(text);
    let compliance = null;
    if (!deduped && keyword) {
      if (keyword === 'stop') { await repo.setOptOut(conv.conversation.id, now()); compliance = { action: 'stop', reply: REPLIES.stop }; }
      else if (keyword === 'start') { await repo.setOptOut(conv.conversation.id, null); compliance = { action: 'start', reply: REPLIES.start }; }
      else if (keyword === 'help') { compliance = { action: 'help', reply: REPLIES.help }; }
    } else if (keyword) {
      compliance = { action: keyword, reply: REPLIES[keyword] || null };
    }

    if (!deduped) {
      await repo.touchConversation(conv.conversation.id, {
        last_message_at: now(),
        last_message_preview: String(text).slice(0, 140),
        last_message_direction: 'inbound',
      });
    }

    // Phase 2A-1: best-effort auto-link to a unique Rosalia lead. Runs AFTER
    // the message + recency are persisted and only on the first (non-deduped)
    // delivery. The linker never throws, sends, or mutates compliance/DNC/opt-out
    // state, so a lookup or link failure can never affect the webhook outcome.
    if (!deduped) {
      await linker.linkInboundConversation({ conversationId: conv.conversation.id, from, to });
    }

    return { ok: true, deduped, message, conversationId: conv.conversation.id, compliance };
  }

  async function processDeliveryStatus(event) {
    const p = (event && event.data && event.data.payload) || {};
    const providerMessageId = p.id || (event.data && event.data.id) || null;
    if (!providerMessageId) return { ok: false, reason: 'no_provider_message_id' };

    const message = await repo.getMessageByProviderId('telnyx', providerMessageId);
    if (!message) return { ok: true, matched: false }; // unmatched — logged by handler, no fake message

    const newStatus = mapDeliveryStatus(event);
    if (!newStatus) return { ok: true, matched: true, updated: false, reason: 'unmapped_event' };

    const currentRank = RANK[message.status] || 0;
    const newRank = RANK[newStatus] || 0;

    // Idempotent + monotonic: ignore duplicates, out-of-order, and downgrades of terminal states.
    if (newStatus === message.status) return { ok: true, matched: true, updated: false, deduped: true, status: message.status };
    if (message.status === 'delivered') return { ok: true, matched: true, updated: false, status: 'delivered' };
    if (newRank < currentRank) return { ok: true, matched: true, updated: false, status: message.status };

    const patch = { status: newStatus };
    if (newStatus === 'delivered') patch.delivered_at = now();
    if (newStatus === 'failed') {
      const failedTo = Array.isArray(p.to) ? p.to.find((t) => /fail/.test(String(t.status || '').toLowerCase())) : null;
      const errObj = (p.errors && p.errors[0]) || (failedTo && failedTo.errors && failedTo.errors[0]) || null;
      patch.error_code = (errObj && errObj.code) || 'delivery_failed';
      patch.error_message = (errObj && errObj.detail) || null;
    }
    const updated = await repo.updateMessage(message.id, patch);
    return { ok: true, matched: true, updated: true, status: newStatus, message: updated };
  }

  return { processInbound, processDeliveryStatus, mapDeliveryStatus, extractInbound };
}

module.exports = { createSmsWebhookProcessor };
