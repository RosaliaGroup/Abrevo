'use strict';
/**
 * In-memory repository fake for Phase 1 tests. Implements the same interface as
 * supabaseRepo.js and enforces the SAME uniqueness the DB does (normalized_phone,
 * idempotency_key, provider message id, and (conversation,entity) link pairs),
 * so concurrency/idempotency behavior is exercised without any network.
 *
 * Uniqueness checks run synchronously at call time (async fn, no await before
 * the check) so racing get-or-create via Promise.all is deterministic.
 */

class UniqueViolationError extends Error {
  constructor(message) {
    super(message || 'unique_violation');
    this.name = 'UniqueViolationError';
    this.code = 'unique_violation';
  }
}

function createFakeRepo() {
  const conversations = new Map();      // id -> conv
  const byPhone = new Map();            // normalized_phone -> id
  const links = [];                     // {id, conversation_id, entity_type, entity_id}
  const messages = [];                  // message rows
  const leads = [];                     // {id, phone, client} — seeded by tests
  let cN = 0, mN = 0, lN = 0;

  const repo = {
    UniqueViolationError,
    _state: { conversations, messages, links, leads },

    async getConversationByPhone(e164) {
      const id = byPhone.get(e164);
      return id ? { ...conversations.get(id) } : null;
    },
    async getConversationById(id) {
      return conversations.has(id) ? { ...conversations.get(id) } : null;
    },
    async insertConversation({ normalized_phone, created_by }) {
      if (byPhone.has(normalized_phone)) throw new UniqueViolationError('normalized_phone');
      const id = 'c' + (++cN);
      const row = {
        id, normalized_phone, status: 'open', opted_out_at: null,
        created_by: created_by || null, last_message_at: null,
        last_read_at: null, last_message_preview: null, last_message_direction: null,
        created_at: 't', updated_at: 't',
      };
      conversations.set(id, row);
      byPhone.set(normalized_phone, id);
      return { ...row };
    },
    async touchConversation(id, patch) {
      const row = conversations.get(id);
      if (!row) throw new Error('not found');
      Object.assign(row, patch, { updated_at: 't' });
      return { ...row };
    },
    async listLinks(conversationId) {
      return links.filter((l) => l.conversation_id === conversationId).map((l) => ({ ...l }));
    },
    async listConversationsByEntity(entityType, entityId) {
      const eid = String(entityId);
      return links
        .filter((l) => l.entity_type === entityType && l.entity_id === eid)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((l) => ({ ...l }));
    },
    // Mirrors supabaseRepo.findLeadsByPhone: tenant-scoped (client='rosalia')
    // coarse match on exact E.164 or last-10-digit substring. Non-Rosalia leads
    // are never returned, exactly as the real query pins client='rosalia'.
    async findLeadsByPhone(e164, last10) {
      return leads
        .filter((l) => l.client === 'rosalia' && (
          (e164 && String(l.phone) === String(e164)) ||
          (last10 && String(l.phone).includes(String(last10)))))
        .map((l) => ({ ...l }));
    },
    async insertLinkIfAbsent({ conversation_id, entity_type, entity_id }) {
      const eid = String(entity_id);
      const dup = links.find((l) =>
        l.conversation_id === conversation_id && l.entity_type === entity_type && l.entity_id === eid);
      if (dup) return null;
      const row = { id: 'l' + (++lN), conversation_id, entity_type, entity_id: eid, created_at: 't' };
      links.push(row);
      return { ...row };
    },
    async getMessageByIdempotencyKey(key) {
      const m = messages.find((x) => x.idempotency_key === key);
      return m ? { ...m } : null;
    },
    async insertMessage(row) {
      if (row.idempotency_key != null && messages.some((x) => x.idempotency_key === row.idempotency_key)) {
        throw new UniqueViolationError('idempotency_key');
      }
      if (row.provider_message_id != null &&
          messages.some((x) => x.provider === row.provider && x.provider_message_id === row.provider_message_id)) {
        throw new UniqueViolationError('provider_message_id');
      }
      const stored = { id: 'm' + (++mN), provider_message_id: null, sent_at: null,
        delivered_at: null, received_at: null, error_code: null, error_message: null, ...row };
      messages.push(stored);
      return { ...stored };
    },
    async updateMessage(id, patch) {
      const m = messages.find((x) => x.id === id);
      if (!m) throw new Error('message not found');
      Object.assign(m, patch);
      return { ...m };
    },
    async getMessageById(id) {
      const m = messages.find((x) => x.id === id);
      return m ? { ...m } : null;
    },
    async getMessageByProviderId(provider, pmid) {
      const m = messages.find((x) => x.provider === provider && x.provider_message_id === pmid);
      return m ? { ...m } : null;
    },
    async listConversations({ limit = 25, offset = 0 } = {}) {
      const all = [...conversations.values()].sort((a, b) => {
        const la = a.last_message_at || '', lb = b.last_message_at || '';
        if (la !== lb) return lb.localeCompare(la); // desc, '' (null) sorts last
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      return all.slice(offset, offset + limit).map((c) => ({ ...c }));
    },
    async listMessages(conversationId, { limit = 50, offset = 0 } = {}) {
      const all = messages
        .filter((m) => m.conversation_id === conversationId)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return all.slice(offset, offset + limit).map((m) => ({ ...m }));
    },
    async setOptOut(conversationId, at) { return this.touchConversation(conversationId, { opted_out_at: at }); },
    async markRead(conversationId, at) { return this.touchConversation(conversationId, { last_read_at: at }); },
  };
  return repo;
}

module.exports = { createFakeRepo, UniqueViolationError };
