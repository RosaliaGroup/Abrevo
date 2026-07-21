'use strict';
/**
 * Server-side data layer for the CRM dashboard (crm.html), replacing the
 * browser's direct Supabase access with the exposed service-role key.
 *
 * Security posture:
 *   - The service-role key lives ONLY on the server (env SUPABASE_SERVICE_KEY);
 *     it is never sent to the browser.
 *   - Read queries are FIXED server-side (the client cannot pass arbitrary
 *     PostgREST filters) — only a small set of whitelisted, validated params.
 *   - Writes accept only whitelisted columns per table; created_at is server-set;
 *     ids are format-validated. No arbitrary column or table is reachable.
 *   - Errors are normalized; raw DB errors/credentials are never returned.
 *
 * `fetchImpl` is injectable for tests (no network).
 */

const ID_RE = /^[A-Za-z0-9_-]+$/;          // uuid or bigint-as-string
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;      // YYYY-MM-DD

// Fixed read queries (no client-supplied filter strings).
const READS = {
  leads:       () => 'leads?order=created_at.desc&limit=500',
  agents:      () => 'agents?order=name.asc',
  deals:       () => 'deals?order=created_at.desc',
  commissions: () => 'commissions?order=created_at.desc',
  tasks:       () => 'tasks?order=due_date.asc',
  sequences:   () => 'follow_up_sequences?order=name.asc',
};

// Allowed columns per create action (everything else is dropped).
const CREATE_FIELDS = {
  leads:  ['name', 'email', 'phone', 'source', 'property', 'assigned_to', 'notes', 'status', 'client'],
  deals:  ['lead_id', 'property', 'monthly_rent', 'stage', 'agent_id', 'notes'],
  tasks:  ['title', 'lead_id', 'assigned_to', 'due_date', 'priority', 'description', 'status'],
  agents: ['name', 'email', 'phone', 'role'],
};

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}
function err(code, message) { return { ok: false, error: { code, message } }; }

function createCrmData(opts = {}) {
  const url = opts.url || process.env.SUPABASE_URL;
  const serviceKey = opts.serviceKey || process.env.SUPABASE_SERVICE_KEY;
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const clock = opts.clock || (() => new Date().toISOString());
  if (!url || !serviceKey) throw new Error('createCrmData: SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  if (!fetchImpl) throw new Error('createCrmData: no fetch implementation');

  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  async function rest(method, path, { body, prefer } = {}) {
    const headers = { ...H };
    if (prefer) headers.Prefer = prefer;
    const res = await fetchImpl(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; if (text) { try { json = JSON.parse(text); } catch (_) {} }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, json };
  }

  async function list(action) {
    const q = READS[action];
    if (!q) return err('unknown_action', `unknown read '${action}'`);
    const r = await rest('GET', '/' + q());
    if (!r.ok) return err('read_failed', 'could not load data');
    return { ok: true, data: Array.isArray(r.json) ? r.json : [] };
  }

  async function bookings({ from, to }) {
    if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) return err('bad_params', 'from/to must be YYYY-MM-DD');
    const r = await rest('GET', `/bookings?preferred_date=gte.${from}&preferred_date=lte.${to}&limit=100`);
    if (!r.ok) return err('read_failed', 'could not load bookings');
    return { ok: true, data: Array.isArray(r.json) ? r.json : [] };
  }

  async function activities({ lead_id }) {
    if (!ID_RE.test(String(lead_id || ''))) return err('bad_id', 'invalid lead_id');
    const r = await rest('GET', `/activities?lead_id=eq.${encodeURIComponent(lead_id)}&order=created_at.desc&limit=20`);
    if (!r.ok) return err('read_failed', 'could not load activities');
    return { ok: true, data: Array.isArray(r.json) ? r.json : [] };
  }

  async function create(table, payload) {
    const fields = CREATE_FIELDS[table];
    if (!fields) return err('unknown_action', `cannot create '${table}'`);
    const row = pick(payload || {}, fields);
    // Minimal required-field validation (mirrors the current UI).
    if (table === 'leads' && !row.name && !row.email) return err('validation', 'name or email required');
    if (table === 'tasks' && !row.title) return err('validation', 'task title required');
    if (table === 'agents' && !row.name) return err('validation', 'name required');
    if (table === 'leads') { row.status = row.status || 'new'; row.client = row.client || 'rosalia'; }
    if (table === 'tasks') { row.status = row.status || 'pending'; }
    row.created_at = clock(); // server-set; never trust client timestamp
    const r = await rest('POST', `/${table}`, { body: row, prefer: 'return=representation' });
    if (!r.ok) return err('write_failed', `could not create ${table}`);
    const created = Array.isArray(r.json) ? r.json[0] : r.json;
    return { ok: true, data: { id: created && created.id } };
  }

  async function patchStatus(table, id, patch) {
    if (!ID_RE.test(String(id || ''))) return err('bad_id', 'invalid id');
    const r = await rest('PATCH', `/${table}?id=eq.${encodeURIComponent(id)}`, { body: patch, prefer: 'return=minimal' });
    if (!r.ok) return err('write_failed', `could not update ${table}`);
    return { ok: true };
  }

  async function completeTask({ id }) { return patchStatus('tasks', id, { status: 'completed', completed_at: clock() }); }
  async function payCommission({ id }) { return patchStatus('commissions', id, { status: 'paid', paid_at: clock() }); }

  return { list, bookings, activities, create, completeTask, payCommission, READS, CREATE_FIELDS };
}

module.exports = { createCrmData };
