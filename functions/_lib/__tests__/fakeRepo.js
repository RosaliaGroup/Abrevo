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
  let cN = 0, mN = 0, lN = 0;

  const repo = {
    UniqueViolationError,
    _state: { conversations, messages, links },

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
  };
  return repo;
}

module.exports = { createFakeRepo, UniqueViolationError };
