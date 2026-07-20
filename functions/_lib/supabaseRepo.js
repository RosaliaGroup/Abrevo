'use strict';
/**
 * Server-only data-access layer for the Communications tables, over Supabase
 * PostgREST (the same access pattern the rest of Abrevo uses: fetch + apikey +
 * Bearer service key). This module must never run in the browser and never
 * exposes the service key to a client.
 *
 * `fetchImpl` is injectable so unit tests can supply a mock transport and assert
 * the exact PostgREST requests without any network I/O.
 *
 * Credentials come only from the environment (never hardcoded):
 *   SUPABASE_URL           e.g. https://fhkgpepkwibxbxsepetd.supabase.co
 *   SUPABASE_SERVICE_KEY   service-role key (server-side only)
 */

class UniqueViolationError extends Error {
  constructor(message) {
    super(message || 'unique_violation');
    this.name = 'UniqueViolationError';
    this.code = 'unique_violation';
  }
}

function createSupabaseRepo(opts = {}) {
  const url = opts.url || process.env.SUPABASE_URL;
  const serviceKey = opts.serviceKey || process.env.SUPABASE_SERVICE_KEY;
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);

  if (!url || !serviceKey) {
    throw new Error('createSupabaseRepo: SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  }
  if (!fetchImpl) {
    throw new Error('createSupabaseRepo: no fetch implementation available');
  }

  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const baseHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  async function rest(method, path, { body, prefer } = {}) {
    const headers = { ...baseHeaders };
    if (prefer) headers.Prefer = prefer;
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (_) { json = null; } }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, json, text };
  }

  const enc = encodeURIComponent;

  return {
    UniqueViolationError,

    async getConversationByPhone(e164) {
      const r = await rest('GET', `/conversations?normalized_phone=eq.${enc(e164)}&limit=1`);
      if (!r.ok) throw new Error(`getConversationByPhone failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) && r.json.length ? r.json[0] : null;
    },

    async getConversationById(id) {
      const r = await rest('GET', `/conversations?id=eq.${enc(id)}&limit=1`);
      if (!r.ok) throw new Error(`getConversationById failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) && r.json.length ? r.json[0] : null;
    },

    async insertConversation({ normalized_phone, created_by }) {
      const r = await rest('POST', '/conversations', {
        prefer: 'return=representation',
        body: { normalized_phone, created_by: created_by || null },
      });
      if (r.status === 409) throw new UniqueViolationError('conversations.normalized_phone');
      if (!r.ok) throw new Error(`insertConversation failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json[0] : r.json;
    },

    async touchConversation(id, patch) {
      const body = { updated_at: new Date().toISOString(), ...patch };
      const r = await rest('PATCH', `/conversations?id=eq.${enc(id)}`, {
        prefer: 'return=representation',
        body,
      });
      if (!r.ok) throw new Error(`touchConversation failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json[0] : r.json;
    },

    async listLinks(conversationId) {
      const r = await rest('GET', `/conversation_links?conversation_id=eq.${enc(conversationId)}`);
      if (!r.ok) throw new Error(`listLinks failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json : [];
    },

    /** Idempotent: returns the new link, or null if the pair already existed. */
    async insertLinkIfAbsent({ conversation_id, entity_type, entity_id }) {
      const r = await rest('POST', '/conversation_links', {
        prefer: 'return=representation',
        body: { conversation_id, entity_type, entity_id: String(entity_id) },
      });
      if (r.status === 409) return null; // already linked
      if (!r.ok) throw new Error(`insertLinkIfAbsent failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json[0] : r.json;
    },

    async getMessageByIdempotencyKey(key) {
      const r = await rest('GET', `/messages?idempotency_key=eq.${enc(key)}&limit=1`);
      if (!r.ok) throw new Error(`getMessageByIdempotencyKey failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) && r.json.length ? r.json[0] : null;
    },

    async insertMessage(row) {
      const r = await rest('POST', '/messages', {
        prefer: 'return=representation',
        body: row,
      });
      if (r.status === 409) throw new UniqueViolationError('messages idempotency/provider id');
      if (!r.ok) throw new Error(`insertMessage failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json[0] : r.json;
    },

    async updateMessage(id, patch) {
      const r = await rest('PATCH', `/messages?id=eq.${enc(id)}`, {
        prefer: 'return=representation',
        body: patch,
      });
      if (!r.ok) throw new Error(`updateMessage failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json[0] : r.json;
    },
  };
}

module.exports = { createSupabaseRepo, UniqueViolationError };
