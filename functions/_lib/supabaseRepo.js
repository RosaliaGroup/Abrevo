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

    // Reverse lookup: which conversation(s) is a CRM entity linked to?
    // e.g. (entity_type='lead', entity_id=<leadId>). Backed by
    // conversation_links_entity_idx (entity_type, entity_id). Read-only.
    async listConversationsByEntity(entityType, entityId) {
      const r = await rest('GET',
        `/conversation_links?entity_type=eq.${enc(entityType)}&entity_id=eq.${enc(String(entityId))}&order=created_at.asc`);
      if (!r.ok) throw new Error(`listConversationsByEntity failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json : [];
    },

    // Tenant-scoped coarse lead lookup for inbound-SMS auto-linking (Phase
    // 2A-1). The query pins client='rosalia' so Mechanical / non-Rosalia leads
    // can NEVER be returned; it matches an exact E.164 or a last-10-digit
    // substring. The caller (leadLinker) re-normalizes each candidate for an
    // exact confirmation. Read-only.
    async findLeadsByPhone(e164, last10) {
      const or = [];
      if (e164) or.push(`phone.eq.${String(e164).replace('+', '%2B')}`);
      if (last10) or.push(`phone.ilike.*${enc(String(last10))}*`);
      if (or.length === 0) return [];
      const r = await rest('GET',
        `/leads?select=id,phone,client&client=eq.rosalia&or=(${or.join(',')})&limit=25`);
      if (!r.ok) throw new Error(`findLeadsByPhone failed: ${r.status} ${r.text.slice(0, 200)}`);
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

    async getMessageById(id) {
      const r = await rest('GET', `/messages?id=eq.${enc(id)}&limit=1`);
      if (!r.ok) throw new Error(`getMessageById failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) && r.json.length ? r.json[0] : null;
    },

    async getMessageByProviderId(provider, providerMessageId) {
      const r = await rest('GET',
        `/messages?provider=eq.${enc(provider)}&provider_message_id=eq.${enc(providerMessageId)}&limit=1`);
      if (!r.ok) throw new Error(`getMessageByProviderId failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) && r.json.length ? r.json[0] : null;
    },

    // Conversations ordered by most-recent activity (nulls last), paginated.
    async listConversations({ limit = 25, offset = 0 } = {}) {
      const r = await rest('GET',
        `/conversations?order=last_message_at.desc.nullslast,created_at.desc&limit=${enc(limit)}&offset=${enc(offset)}`);
      if (!r.ok) throw new Error(`listConversations failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json : [];
    },

    // Calls awaiting operator review (attention_cleared_at IS NULL). The
    // "No booking…" flag fires on nearly every call, so it is not selective;
    // boilerplate-only rows are dropped client-side, not here. Read-only, newest
    // first. `flags` is jsonb and comes back as a JS array.
    async listCallsNeedingAttention({ limit = 200 } = {}) {
      const r = await rest('GET',
        `/calls?attention_cleared_at=is.null` +
        `&select=id,caller_phone,caller_name,assistant,outcome,summary,flags,recording_url,created_at` +
        `&order=created_at.desc&limit=${enc(limit)}`);
      if (!r.ok) throw new Error(`listCallsNeedingAttention failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json : [];
    },

    // Manual "mark reviewed": stamp attention_cleared_at. Idempotent — clearing
    // an already-cleared call just re-stamps it. Returns the row, or null if the
    // id matched nothing.
    async clearCallAttention(id, at) {
      const r = await rest('PATCH', `/calls?id=eq.${enc(id)}`, {
        prefer: 'return=representation',
        body: { attention_cleared_at: at || new Date().toISOString() },
      });
      if (!r.ok) throw new Error(`clearCallAttention failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) && r.json.length ? r.json[0] : null;
    },

    // "Needs attention — Email replies": leads with >1 inbound email. No RPC/view —
    // page inbound metadata (no body) and group in Node, then hydrate qualifying
    // leads BY ID (not bound by the crm-list 500 cap, and gets email_attention_cleared_at).
    // Vendor-exclusion and the cleared-at "reappear" rule are applied client-side,
    // mirroring the calls panel. Returns the >1-inbound superset; the browser filters.
    async listEmailAttention({ pageSize = 1000, maxRows = 20000 } = {}) {
      const inList = (ids) => `(${ids.map((x) => enc(x)).join(',')})`;
      // Pass 1: all inbound metadata, newest first (no body — keep it narrow).
      const inbound = [];
      for (let off = 0; off < maxRows; off += pageSize) {
        const r = await rest('GET',
          `/emails?direction=eq.inbound&select=id,lead_id,subject,from_email,created_at` +
          `&order=created_at.desc&limit=${pageSize}&offset=${off}`);
        if (!r.ok) throw new Error(`listEmailAttention inbound failed: ${r.status} ${r.text.slice(0, 200)}`);
        const rows = Array.isArray(r.json) ? r.json : [];
        inbound.push(...rows);
        if (rows.length < pageSize) break;
      }
      // Group by lead. Rows are global desc, so the first seen per lead is newest.
      const byLead = new Map();
      for (const e of inbound) {
        if (e.lead_id == null) continue;
        const g = byLead.get(e.lead_id) || { count: 0, newest: null };
        g.count += 1; if (!g.newest) g.newest = e;
        byLead.set(e.lead_id, g);
      }
      const leadIds = [...byLead.entries()].filter(([, g]) => g.count > 1).map(([id]) => id);
      if (!leadIds.length) return [];
      // Pass 2: hydrate qualifying leads (name / email / cleared-at).
      const lr = await rest('GET', `/leads?id=in.${inList(leadIds)}&select=id,name,email,email_attention_cleared_at`);
      if (!lr.ok) throw new Error(`listEmailAttention leads failed: ${lr.status} ${lr.text.slice(0, 200)}`);
      const leads = Array.isArray(lr.json) ? lr.json : [];
      // Pass 3: outbound counts for these leads (narrow: lead_id only).
      const outByLead = new Map();
      for (let off = 0; off < maxRows; off += pageSize) {
        const r = await rest('GET', `/emails?direction=eq.outbound&lead_id=in.${inList(leadIds)}&select=lead_id&limit=${pageSize}&offset=${off}`);
        if (!r.ok) break;
        const rows = Array.isArray(r.json) ? r.json : [];
        for (const e of rows) outByLead.set(e.lead_id, (outByLead.get(e.lead_id) || 0) + 1);
        if (rows.length < pageSize) break;
      }
      // Pass 4: newest-inbound body for the snippet (only these leads' newest ids).
      const bodyById = new Map();
      const newestIds = leadIds.map((id) => byLead.get(id).newest.id);
      const br = await rest('GET', `/emails?id=in.${inList(newestIds)}&select=id,body`);
      if (br.ok && Array.isArray(br.json)) for (const e of br.json) bodyById.set(e.id, e.body);
      return leads.map((l) => {
        const g = byLead.get(l.id); const n = g.newest;
        return {
          lead_id: l.id, name: l.name || null, email: l.email || null,
          email_attention_cleared_at: l.email_attention_cleared_at || null,
          subject: n.subject || null,
          snippet: String(bodyById.get(n.id) || '').replace(/\s+/g, ' ').trim().slice(0, 140),
          last_inbound_at: n.created_at,
          inbound_count: g.count, outbound_count: outByLead.get(l.id) || 0,
        };
      });
    },

    // Manual "mark reviewed": stamp leads.email_attention_cleared_at. Idempotent —
    // clearing again just re-stamps it. Returns the row, or null if id matched nothing.
    async clearEmailAttention(leadId, at) {
      const r = await rest('PATCH', `/leads?id=eq.${enc(leadId)}`, {
        prefer: 'return=representation',
        body: { email_attention_cleared_at: at || new Date().toISOString() },
      });
      if (!r.ok) throw new Error(`clearEmailAttention failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) && r.json.length ? r.json[0] : null;
    },

    // Messages of a conversation in chronological order, paginated.
    async listMessages(conversationId, { limit = 50, offset = 0 } = {}) {
      const r = await rest('GET',
        `/messages?conversation_id=eq.${enc(conversationId)}&order=created_at.asc&limit=${enc(limit)}&offset=${enc(offset)}`);
      if (!r.ok) throw new Error(`listMessages failed: ${r.status} ${r.text.slice(0, 200)}`);
      return Array.isArray(r.json) ? r.json : [];
    },

    async setOptOut(conversationId, at) {
      return this.touchConversation(conversationId, { opted_out_at: at });
    },

    async markRead(conversationId, at) {
      return this.touchConversation(conversationId, { last_read_at: at });
    },
  };
}

module.exports = { createSupabaseRepo, UniqueViolationError };
