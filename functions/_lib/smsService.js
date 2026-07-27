'use strict';
/**
 * Outbound SMS orchestration foundation.
 *
 * Ties together: conversation get-or-create -> opt-out enforcement ->
 * idempotency -> persist message -> Telnyx send -> persist result. This is the
 * single server-side path a future migrated sender will call. It performs NO
 * production send on its own in Phase 1; tests drive it with a mock Telnyx
 * transport, so nothing leaves the process.
 *
 * Idempotency: when the caller supplies `idempotencyKey`, at most one message
 * is ever sent for that key. If a message with the key already exists, the
 * existing message is returned and NO new send occurs. A race on the same key
 * is caught via the DB UNIQUE(idempotency_key) and resolves to the existing
 * message.
 *
 * Dependencies are injected: { conversationService, repo, telnyx, clock }.
 */

function createSmsService({ conversationService, repo, telnyx, clock } = {}) {
  if (!conversationService) throw new Error('createSmsService: conversationService required');
  if (!repo) throw new Error('createSmsService: repo required');
  if (!telnyx) throw new Error('createSmsService: telnyx required');
  const now = clock || (() => new Date().toISOString());

  /**
   * @param {object} args
   * @param {unknown} [args.phone]            required unless conversationId given
   * @param {string}  [args.conversationId]   target an existing conversation directly
   * @param {string}  args.body               message text
   * @param {string}  [args.idempotencyKey]   de-dupes retries of the same logical send
   * @param {Array}   [args.links]            CRM linkage passed through to get-or-create
   * @param {string}  [args.createdBy]
   */
  async function sendMessage({ phone, conversationId, body, idempotencyKey, links = [], createdBy } = {}) {
    if (!body || String(body).length === 0) {
      return { ok: false, reason: 'empty_body' };
    }

    // Idempotency short-circuit (before any conversation work or send).
    if (idempotencyKey) {
      const existing = await repo.getMessageByIdempotencyKey(idempotencyKey);
      if (existing) {
        return { ok: true, deduped: true, message: existing, providerResult: null };
      }
    }

    // Resolve the conversation.
    let conversation;
    if (conversationId) {
      conversation = await repo.getConversationById(conversationId);
      if (!conversation) return { ok: false, reason: 'conversation_not_found' };
    } else {
      const conv = await conversationService.getOrCreateConversation({ phone, links, createdBy });
      if (!conv.ok) return { ok: false, reason: conv.reason, phone: conv.phone };
      conversation = conv.conversation;
    }

    // Enforce opt-out BEFORE sending. Persist a blocked record for audit; no send.
    if (conversation.opted_out_at) {
      const blocked = await repo.insertMessage({
        conversation_id: conversation.id,
        direction: 'outbound',
        body,
        status: 'blocked',
        provider: 'telnyx',
        idempotency_key: idempotencyKey || null,
        error_code: 'opted_out',
        error_message: 'recipient has opted out',
        created_at: now(),
      });
      return { ok: false, reason: 'opted_out', message: blocked, providerResult: null };
    }

    // Persist the outbound message BEFORE the provider call (audit trail).
    let message;
    try {
      message = await repo.insertMessage({
        conversation_id: conversation.id,
        direction: 'outbound',
        body,
        status: 'queued',
        provider: 'telnyx',
        idempotency_key: idempotencyKey || null,
        created_at: now(),
      });
    } catch (err) {
      // Racing duplicate on idempotency_key -> return the winner's message.
      const isUnique = err && (err.name === 'UniqueViolationError' || err.code === 'unique_violation');
      if (isUnique && idempotencyKey) {
        const existing = await repo.getMessageByIdempotencyKey(idempotencyKey);
        if (existing) return { ok: true, deduped: true, message: existing, providerResult: null };
      }
      throw err;
    }

    // Send via Telnyx and persist the outcome.
    const result = await telnyx.sendSms({ to: conversation.normalized_phone, text: body });

    let patch;
    if (result.success) {
      patch = { status: 'sent', provider_message_id: result.providerMessageId || null, sent_at: now() };
    } else {
      patch = { status: 'failed', error_code: result.errorCode || 'send_failed', error_message: result.errorMessage || null };
    }
    const updated = await repo.updateMessage(message.id, patch);
    await repo.touchConversation(conversation.id, { last_message_at: now() });

    return { ok: result.success, message: updated, providerResult: result };
  }

  return { sendMessage };
}

module.exports = { createSmsService };
