'use strict';
/**
 * Internal Communications API (server-owned business logic).
 *
 * Pure logic over injected { repo, conversationService, smsService }. No HTTP,
 * no credentials here — the Netlify handler (functions/communications.js) owns
 * request/response and reads env. Returns stable result shapes:
 *   success -> { ok: true, ... }
 *   failure -> { ok: false, error: { code, message } }
 *
 * Never creates or duplicates a CRM entity; only links by stable id.
 */

const { SUPPORTED_ENTITY_TYPES } = require('./conversations');
// Reused so the "Needs attention — Calls" panel excludes our own/internal lines
// the same way outbound alerting does — single source of truth for the list.
const { isInternalNumber } = require('./threadLog');

const MAX_PAGE = 100;

function clampLimit(v, def) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, MAX_PAGE);
}
function clampOffset(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function err(code, message) { return { ok: false, error: { code, message } }; }

function createCommApi({ repo, conversationService, smsService } = {}) {
  if (!repo || !conversationService || !smsService) {
    throw new Error('createCommApi: repo, conversationService, smsService required');
  }

  async function findOrCreateConversation({ phone, links, createdBy } = {}) {
    const res = await conversationService.getOrCreateConversation({ phone, links, createdBy });
    if (!res.ok) return err(res.reason, `phone rejected: ${res.reason}`);
    return { ok: true, created: res.created, conversation: res.conversation, links: res.links, skippedLinks: res.skippedLinks };
  }

  async function addLink({ conversationId, type, id } = {}) {
    if (!conversationId) return err('missing_conversation_id', 'conversationId is required');
    if (!SUPPORTED_ENTITY_TYPES.has(type)) return err('unsupported_entity_type', `entity type '${type}' is not linkable`);
    if (id === null || id === undefined || String(id).length === 0) return err('missing_entity_id', 'entity id is required');
    const conv = await repo.getConversationById(conversationId);
    if (!conv) return err('conversation_not_found', 'no such conversation');
    const link = await repo.insertLinkIfAbsent({ conversation_id: conversationId, entity_type: type, entity_id: String(id) });
    return { ok: true, added: Boolean(link), link: link || null };
  }

  async function listConversations({ limit, offset } = {}) {
    const lim = clampLimit(limit, 25);
    const off = clampOffset(offset);
    const rows = await repo.listConversations({ limit: lim + 1, offset: off }); // +1 to detect next page
    const hasMore = rows.length > lim;
    const page = hasMore ? rows.slice(0, lim) : rows;
    // Attach linkage summaries so the list can show CRM context.
    const withLinks = [];
    for (const c of page) {
      const links = await repo.listLinks(c.id);
      withLinks.push({ ...c, links });
    }
    return { ok: true, conversations: withLinks, limit: lim, offset: off, hasMore };
  }

  async function getThread({ conversationId, limit, offset } = {}) {
    if (!conversationId) return err('missing_conversation_id', 'conversationId is required');
    const conv = await repo.getConversationById(conversationId);
    if (!conv) return err('conversation_not_found', 'no such conversation');
    const lim = clampLimit(limit, 50);
    const off = clampOffset(offset);
    const rows = await repo.listMessages(conversationId, { limit: lim + 1, offset: off });
    const hasMore = rows.length > lim;
    const messages = hasMore ? rows.slice(0, lim) : rows;
    const links = await repo.listLinks(conversationId);
    return { ok: true, conversation: { ...conv, links }, messages, limit: lim, offset: off, hasMore };
  }

  // Read-only: a lead's linked conversation(s) and their merged, chronological
  // message timeline. Resolves ONLY via existing entity links (entity_type
  // 'lead'); never creates or links a conversation (that is a write path), and
  // only returns messages from conversations explicitly linked to THIS lead, so
  // one lead's messages can never surface under another. Empty state when the
  // lead has no linked conversation.
  async function getLeadThread({ leadId, limit, offset } = {}) {
    if (leadId === null || leadId === undefined || String(leadId).length === 0) {
      return err('missing_entity_id', 'leadId is required');
    }
    const lim = clampLimit(limit, 50);
    const off = clampOffset(offset);
    const linkRows = await repo.listConversationsByEntity('lead', String(leadId));
    const seen = new Set();
    const conversations = [];
    const messages = [];
    for (const link of linkRows) {
      const cid = link.conversation_id;
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      const conv = await repo.getConversationById(cid);
      if (!conv) continue;
      conversations.push({
        id: conv.id, normalized_phone: conv.normalized_phone, status: conv.status,
        opted_out_at: conv.opted_out_at || null, last_message_at: conv.last_message_at || null,
      });
      const rows = await repo.listMessages(cid, { limit: lim, offset: off });
      for (const m of rows) messages.push({ ...m, conversation_id: cid });
    }
    // Deterministic chronological order across all linked conversations
    // (created_at, then id as a stable tiebreaker).
    messages.sort((a, b) => {
      const ta = String(a.created_at || ''); const tb = String(b.created_at || '');
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return String(a.id).localeCompare(String(b.id));
    });
    return { ok: true, leadId: String(leadId), linked: conversations.length > 0, conversations, messages };
  }

  async function sendMessage({ phone, conversationId, body, idempotencyKey, links, createdBy } = {}) {
    const res = await smsService.sendMessage({ phone, conversationId, body, idempotencyKey, links, createdBy });
    if (res.ok) return { ok: true, message: res.message, deduped: Boolean(res.deduped) };
    // Map service reasons to stable API errors.
    return { ...err(res.reason || 'send_failed', `send failed: ${res.reason || 'unknown'}`), message: res.message || null };
  }

  async function getMessageStatus({ id } = {}) {
    if (!id) return err('missing_message_id', 'message id is required');
    const m = await repo.getMessageById(id);
    if (!m) return err('message_not_found', 'no such message');
    return { ok: true, id: m.id, status: m.status, provider_message_id: m.provider_message_id || null,
      error_code: m.error_code || null, sent_at: m.sent_at || null, delivered_at: m.delivered_at || null };
  }

  async function markRead({ conversationId, at } = {}) {
    if (!conversationId) return err('missing_conversation_id', 'conversationId is required');
    const conv = await repo.getConversationById(conversationId);
    if (!conv) return err('conversation_not_found', 'no such conversation');
    const updated = await repo.markRead(conversationId, at || new Date().toISOString());
    return { ok: true, conversation: updated };
  }

  // Read-only feed for the CRM "Needs attention — Calls" panel. Two kinds of row
  // come back in one `calls` array (client splits on callback_type):
  //
  //   • Call-back requests — grouped by caller (last-10 digits): one row per
  //     caller, carrying the MOST RECENT request for display, a `count` of that
  //     caller's requests, and every un-cleared request `id` in `ids` so a single
  //     "Mark reviewed" clears all of them. `callback_type` is 'management' if ANY
  //     of the caller's requests was a management escalation, else 'agent' — the
  //     same MANAGEMENT-wins precedence as the recap email (call-recap-inquiries.js).
  //   • Other flagged calls — one row per call (missed/dropped etc.), for the
  //     collapsed section; `callback_type` is null, `ids` is [that call], count 1.
  //
  // The call-back signal is derived from the transcript here (same phrases as the
  // recap email); the raw transcript is dropped before returning. Internal/own
  // numbers are excluded via threadLog. The "No booking…" boilerplate flag is not
  // selective, so it is filtered out. Limit clamps generously; the set is small.
  async function listCallsNeedingAttention({ limit } = {}) {
    const n = Number.parseInt(limit, 10);
    const lim = Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 200;
    const calls = await repo.listCallsNeedingAttention({ limit: lim });

    const classify = (t) => {
      const s = String(t || '');
      if (/escalate this to management/i.test(s)) return 'management';
      if (/message the agent to call you back/i.test(s)) return 'agent';
      return null;
    };
    const isReal = (f) => !/^No booking/.test(String(f));
    const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

    // Rows arrive newest-first, so the first request seen per caller is the most
    // recent one (the representative). `order` preserves that newest-first order.
    const order = [];
    const groups = new Map();
    const flagged = [];
    for (const c of calls) {
      if (isInternalNumber(c.caller_phone)) continue;
      const ct = classify(c.transcript);
      if (ct) {
        const key = last10(c.caller_phone) || ('id:' + c.id);
        let g = groups.get(key);
        if (!g) {
          g = {
            caller_phone: c.caller_phone, caller_name: c.caller_name,
            created_at: c.created_at, summary: c.summary, recording_url: c.recording_url,
            callback_type: ct, count: 0, ids: [],
          };
          groups.set(key, g); order.push(key);
        }
        g.count += 1;
        g.ids.push(c.id);
        if (ct === 'management') g.callback_type = 'management'; // MANAGEMENT wins
        continue;
      }
      const real = (Array.isArray(c.flags) ? c.flags : []).filter(isReal);
      if (real.length) {
        flagged.push({
          caller_phone: c.caller_phone, caller_name: c.caller_name,
          created_at: c.created_at, summary: c.summary, recording_url: c.recording_url,
          callback_type: null, count: 1, ids: [c.id], flags: real,
        });
      }
    }
    const callbacks = order.map((k) => groups.get(k));
    return { ok: true, calls: [...callbacks, ...flagged], limit: lim };
  }

  async function clearCallAttention({ id, at } = {}) {
    if (id === null || id === undefined || String(id).length === 0) {
      return err('missing_call_id', 'call id is required');
    }
    const updated = await repo.clearCallAttention(id, at || new Date().toISOString());
    if (!updated) return err('call_not_found', 'no such call');
    return { ok: true, call: updated };
  }

  // "Needs attention — Email replies": leads with >1 inbound email. Aggregation
  // lives in the repo (no RPC/view); the browser applies vendor-exclusion and the
  // cleared-at "reappear" rule, mirroring the calls panel.
  async function listEmailAttention() {
    const items = await repo.listEmailAttention({});
    return { ok: true, items };
  }

  async function clearEmailAttention({ leadId, at } = {}) {
    if (leadId === null || leadId === undefined || String(leadId).length === 0) {
      return err('missing_lead_id', 'leadId is required');
    }
    const updated = await repo.clearEmailAttention(leadId, at || new Date().toISOString());
    if (!updated) return err('lead_not_found', 'no such lead');
    return { ok: true, lead: updated };
  }

  return { findOrCreateConversation, addLink, listConversations, getThread, getLeadThread, sendMessage, getMessageStatus, markRead, listCallsNeedingAttention, clearCallAttention, listEmailAttention, clearEmailAttention };
}

module.exports = { createCommApi, MAX_PAGE };
