'use strict';
/**
 * Phase 2A-1 — non-throwing inbound-SMS → Rosalia lead auto-linker.
 *
 * Called AFTER the inbound conversation + message are safely persisted. It adds
 * exactly one conversation_links row ONLY when the verified rule holds:
 *
 *   1. TENANT GATE  — the receiving number normalizes exactly to
 *      TELNYX_FROM_ROSALIA (Rosalia's line). Any other/missing destination
 *      performs NO lookup and NO link (no cross-tenant fallback).
 *   2. UNIQUE MATCH — exactly one lead with client='rosalia' whose phone
 *      normalizes exactly to the inbound sender. Zero or multiple → NO link.
 *
 * Guarantees (relied on by the webhook): it NEVER throws, NEVER sends, NEVER
 * mutates conversation/message/compliance state, and NEVER logs PII (no phone
 * numbers, names, or message text) — only a conversation id, a match count, and
 * a reason. conversation_links insertion is idempotent (insertLinkIfAbsent).
 *
 * Do NOT widen the rule here (e.g. null-client leads, name/email fallback,
 * non-Rosalia destinations); those are deliberately excluded for tenant safety.
 */

const { normalizePhone } = require('./phone');

function createLeadLinker({ repo, rosaliaNumber, logger } = {}) {
  if (!repo) throw new Error('createLeadLinker: repo is required');
  const log = logger && typeof logger.log === 'function' ? logger : console;

  // Structured, PII-free log line. Only ever emits: conversation id, a match
  // count, a tenant marker, a reason/flag. Never a phone, name, or body.
  function note(conversationId, fields) {
    const parts = ['[comm-link] inbound-sms', 'conv=' + conversationId];
    for (const k of Object.keys(fields)) parts.push(k + '=' + fields[k]);
    log.log(parts.join(' '));
  }

  async function linkInboundConversation({ conversationId, from, to } = {}) {
    try {
      if (!conversationId) return { linked: false, reason: 'no_conversation' };

      // 1. Tenant gate — deterministic: destination must be Rosalia's line.
      const rosalia = normalizePhone(rosaliaNumber);
      const dest = normalizePhone(to);
      if (!rosalia.ok || !dest.ok || dest.e164 !== rosalia.e164) {
        note(conversationId, { tenant: 'non_rosalia', linked: 0 });
        return { linked: false, reason: 'tenant_mismatch' };
      }

      // Sender must be a normalizable NANP number to compare exactly.
      const sender = normalizePhone(from);
      if (!sender.ok) {
        note(conversationId, { tenant: 'rosalia', lead_match: 0, reason: 'unnormalizable_sender' });
        return { linked: false, reason: 'invalid_sender' };
      }
      const last10 = sender.e164.slice(-10);

      // 2. Tenant-scoped coarse lookup, then EXACT confirmation in code. The
      //    query already excludes non-Rosalia leads; the client re-check and
      //    exact phone normalization defend against coarse ilike over-matches.
      const candidates = await repo.findLeadsByPhone(sender.e164, last10);
      const exact = (Array.isArray(candidates) ? candidates : []).filter((l) => {
        if (!l || l.client !== 'rosalia') return false; // never cross-tenant
        const p = normalizePhone(l.phone);
        return p.ok && p.e164 === sender.e164; // exact phone identity
      });

      if (exact.length === 0) {
        note(conversationId, { tenant: 'rosalia', lead_match: 0 });
        return { linked: false, reason: 'no_match' };
      }
      if (exact.length > 1) {
        note(conversationId, { tenant: 'rosalia', lead_match: exact.length, ambiguous: 1 });
        return { linked: false, reason: 'ambiguous', count: exact.length };
      }

      const leadId = String(exact[0].id);
      const link = await repo.insertLinkIfAbsent({
        conversation_id: conversationId, entity_type: 'lead', entity_id: leadId,
      });
      note(conversationId, { tenant: 'rosalia', lead_match: 1, linked: 1, added: link ? 1 : 0 });
      return { linked: true, leadId, added: Boolean(link) };
    } catch (e) {
      // Must never surface to the webhook. Emit a PII-free error marker only
      // (name, not message — a message could embed a phone/URL).
      note(conversationId || 'unknown', { error: 1, name: (e && e.name) || 'Error' });
      return { linked: false, reason: 'error' };
    }
  }

  return { linkInboundConversation };
}

module.exports = { createLeadLinker };
