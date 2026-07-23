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

  return { findOrCreateConversation, addLink, listConversations, getThread, sendMessage, getMessageStatus, markRead };
}

module.exports = { createCommApi, MAX_PAGE };
