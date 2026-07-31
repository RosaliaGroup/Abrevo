/**
 * Single server-owned authenticated API for the operator dashboards.
 * Routed via netlify.toml:  /api/*  ->  /.netlify/functions/api/:splat
 *
 * - Operator login (scrypt hash in env) issues an HttpOnly, Secure, SameSite=Strict
 *   session cookie (8h absolute TTL). DB-backed login lockout (login_attempts).
 * - Every data/action route requires a valid session; state-changing routes also
 *   require a session-bound CSRF token (X-CSRF-Token).
 * - NOT a generic Supabase proxy: resources, modes, sort, statuses, action names,
 *   and limits are all allow-listed. The service_role key never leaves the server.
 * - Scheduled/internal functions (readmail, healthcheck, inventory) are NOT changed
 *   and keep running without a session; only the browser-facing /api/* paths are gated.
 *
 * SECURITY: never log passwords, hashes, session tokens, or CSRF tokens.
 */
const crypto = require("crypto");
const auth = require("./lib/auth");
const { sendSMS } = require("./lib/sms");

const ENV = () => ({
  URL: process.env.SUPABASE_URL,
  KEY: process.env.SUPABASE_SERVICE_KEY,
  USER: process.env.OPERATOR_USERNAME,
  HASH: process.env.OPERATOR_PASSWORD_HASH,
  SECRET: process.env.OPERATOR_SESSION_SECRET,
});
const TTL_MS = 8 * 60 * 60 * 1000;
const LOCK_MAX = 5;              // failures per window before lockout
const LOCK_WINDOW_MS = 15 * 60 * 1000;

const json = (statusCode, obj, extra) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(extra || {}) },
  body: JSON.stringify(obj),
});

// ---------- Supabase REST (service key, server-side only) ----------
function sbHeaders(extra) {
  const { KEY } = ENV();
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, ...(extra || {}) };
}
async function sbGet(query) {
  const { URL } = ENV();
  const res = await fetch(`${URL}/rest/v1/${query}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`sb_get_${res.status}`);
  return res.json();
}
async function sbPatch(query, body) {
  const { URL } = ENV();
  const res = await fetch(`${URL}/rest/v1/${query}`, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sb_patch_${res.status}`);
  return true;
}

// ---------- Login lockout (DB-backed) ----------
async function recentFailures(ip) {
  const since = new Date(Date.now() - LOCK_WINDOW_MS).toISOString();
  const rows = await sbGet(
    `login_attempts?select=id&success=eq.false&ip=eq.${encodeURIComponent(ip)}&attempted_at=gte.${encodeURIComponent(since)}`
  );
  return Array.isArray(rows) ? rows.length : 0;
}
async function recordAttempt(ip, username, success) {
  const { URL } = ENV();
  await fetch(`${URL}/rest/v1/login_attempts`, {
    method: "POST",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ ip, username, success }),
  });
  // Best-effort expiry of old rows (older than 24h); failures here never block login.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  fetch(`${URL}/rest/v1/login_attempts?attempted_at=lt.${encodeURIComponent(cutoff)}`, {
    method: "DELETE",
    headers: sbHeaders({ Prefer: "return=minimal" }),
  }).catch(() => {});
}

// ---------- Allow-lists (NOT a generic proxy) ----------
const LEAD_MODES = {
  list: () => `leads?client=eq.rosalia&order=created_at.desc&limit=50&select=name,email,phone,source,client,created_at`,
  all: () => `leads?select=*&order=created_at.desc&limit=500`,
  "crm-list": () => `leads?order=created_at.desc&limit=500&select=id,name,email,phone,source,property,status,assigned_to,client,notes,last_contact_at,replied_at,created_at,call_attempts,last_inbound_at,last_inbound_preview,stage_changed_at`,
  "monitor-replied": () => `leads?select=name,replied_at,property&replied_at=not.is.null&order=replied_at.desc&limit=20`,
  "monitor-callattempts": () => `leads?select=call_attempts,phone,updated_at&limit=500`,
  search: (q) =>
    `leads?client=eq.rosalia&or=(name.ilike.*${q}*,email.ilike.*${q}*,phone.ilike.*${q}*)&limit=20&order=created_at.desc`,
  "monitor-unreplied": (_q, since) =>
    `leads?select=name,source,created_at,phone&replied_at=is.null&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`,
};
const BOOKING_MODES = {
  recent: () => `bookings?select=*&order=created_at.desc&limit=10`,
  today: () => {
    const now = new Date();
    const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    return `bookings?select=full_name,phone,preferred_date,preferred_time,calendar_event_id,created_at,type&created_at=gte.${start.toISOString()}&created_at=lt.${end.toISOString()}&order=created_at.desc`;
  },
  "crm-week": () => {
    const day = (d) => d.toISOString().slice(0, 10);
    const from = new Date(); from.setUTCDate(from.getUTCDate() - 7);
    const to = new Date(); to.setUTCDate(to.getUTCDate() + 7);
    return `bookings?select=full_name,phone,preferred_date,preferred_time,type,created_at&preferred_date=gte.${day(from)}&preferred_date=lte.${day(to)}&order=preferred_date.asc&limit=100`;
  },
};
const TASK_STATUSES = {
  resolved: { status: "resolved", stampField: "resolved_at" },   // rosalia
  completed: { status: "completed", stampField: "completed_at" }, // crm
};
const TASK_SORTS = { created: "created_at.desc", due: "due_date.asc" };

// CRM write allow-lists (fixed; unknown keys are rejected, values validated).
const LEAD_SOURCES = new Set(["email", "phone", "zillow", "webflow", "facebook", "instagram", "fub", "walk-in", "avail"]);
const DEAL_STAGES = new Set(["inquiry", "toured", "applied", "approved", "lease_sent", "signed", "moved_in", "lost"]);
const TASK_PRIORITIES = new Set(["normal", "high", "low"]);
// FUB-style ladder. Allow-listed so a bad value from the browser can never
// land in the column and fragment the vocabulary the way the old one did.
const LEAD_STAGES = new Set(["lead", "attempted", "contacted", "appt_set", "applied", "rented", "dnc"]);
const AGENT_ROLES = new Set(["leasing_agent", "manager", "admin"]);
const SOCIAL_CLIENTS = new Set(["rosalia", "mechanical"]);
// Fields social.html's lead table/enrich actually render.
const SOCIAL_LEAD_SELECT = "id,name,email,phone,source,client,created_at,assigned_to,property,status,replied_at";
const COMMISSION_STATUSES = { paid: { status: "paid", stampField: "paid_at" } };

const ValidationError = (field) => { const e = new Error("validation:" + field); e._validation = field; return e; };
function vStr(v, max, field, required) {
  if (v == null || v === "") { if (required) throw ValidationError(field); return null; }
  if (typeof v !== "string") throw ValidationError(field);
  const s = v.trim();
  if (!s) { if (required) throw ValidationError(field); return null; }
  if (s.length > max) throw ValidationError(field);
  return s;
}
function vEmail(v, field) {
  const s = vStr(v, 320, field, false);
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw ValidationError(field);
  return s;
}
function vId(v, field) {
  if (v == null || v === "") return null;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(String(v))) throw ValidationError(field);
  return String(v);
}
function vEnum(v, set, field, required) {
  const s = vStr(v, 64, field, required);
  if (s == null) return null;
  if (!set.has(s)) throw ValidationError(field);
  return s;
}
function vNum(v, field) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw ValidationError(field);
  return n;
}
function vDate(v, field) {
  const s = vStr(v, 40, field, false);
  if (s && !Number.isFinite(Date.parse(s))) throw ValidationError(field);
  return s;
}
async function sbPost(table, row) {
  const res = await fetch(`${ENV().URL}/rest/v1/${table}`, {
    method: "POST",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sb_post_${res.status}`);
  try { const p = JSON.parse(text); const r = Array.isArray(p) ? p[0] : p; return r && r.id != null ? r.id : null; } catch { return null; }
}
const ACTIONS = new Set(["ai-generate", "ai-enrich", "autocall", "healthcheck", "readmail"]);

// Vapi call fields the dashboard actually consumes (everything else is dropped).
function pickVapiCall(c) {
  return {
    createdAt: c && c.createdAt,
    status: c && c.status,
    endedReason: c && c.endedReason,
    duration: c && c.duration,
    assistantId: c && c.assistantId,
    assistant: c && c.assistant ? { name: c.assistant.name } : null,
  };
}

// Cancel-link SMS: fixed, server-owned message template + allow-listed link host.
// The browser never supplies message text — only the destination and the link,
// and the link must point at the approved cancel page.
const CANCEL_LINK_PREFIX = "https://book.rosaliagroup.com/cancel";
const SMS_DUP_WINDOW_MS = 5 * 60 * 1000;      // no repeat to same number within 5 min
const SMS_RATE_MAX = 20;                       // per IP per hour
const SMS_RATE_WINDOW_MS = 60 * 60 * 1000;

function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11) return "+" + d;
  if (d.length >= 12) return "+" + d;
  return null; // fewer than 10 digits -> invalid
}
function firstName(name) {
  return String(name || "").replace(/[^a-zA-Z' -]/g, "").trim().split(/\s+/)[0] || "there";
}
async function smsRecentCount(query) {
  const rows = await sbGet(query);
  return Array.isArray(rows) ? rows.length : 0;
}

// Search input allow-list: bounded charset + length, so it cannot break the PostgREST
// or=() filter or inject operators.
function sanitizeSearch(q) {
  const s = String(q || "").slice(0, 100).replace(/[^a-zA-Z0-9 @._-]/g, "").trim();
  return s;
}
function validId(id) { return /^[A-Za-z0-9-]{1,64}$/.test(String(id || "")); }

// ---------- auth guards ----------
function requireSession(event) {
  const { SECRET } = ENV();
  const token = auth.sessionTokenFromEvent(event);
  const v = auth.verifySession(token, SECRET);
  return v.ok ? { token, user: v.sub } : null;
}
function requireCsrf(event, sessionToken) {
  const { SECRET } = ENV();
  return auth.verifyCsrf(sessionToken, auth.header(event, "X-CSRF-Token"), SECRET);
}

// ---------- action proxy (auth added in front of existing, unchanged functions) ----------
async function proxyAction(name, event) {
  const base = process.env.URL || (event.headers && `https://${event.headers.host}`) || "";
  const res = await fetch(`${base}/.netlify/functions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: event.body || "{}",
  });
  const text = await res.text();
  if (res.status === 404) return json(502, { ok: false, error: "action_unavailable", action: name });
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return json(res.ok ? 200 : 502, { ok: res.ok, data });
}

exports.handler = async (event) => {
  const e = ENV();
  if (!e.URL || !e.KEY || !e.USER || !e.HASH || !e.SECRET) {
    console.error("api: required environment variables are not configured");
    return json(500, { ok: false, error: "server_not_configured" });
  }

  const method = event.httpMethod;
  let route = String(event.path || "").replace(/^\/(?:\.netlify\/functions\/api|api)/, "");
  if (route === "") route = "/";
  const qs = event.queryStringParameters || {};

  try {
    // ---------------- Auth endpoints ----------------
    if (route === "/auth/login" && method === "POST") {
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "invalid_json" }); }
      const ip = auth.getClientIp(event);
      let fails = 0;
      try { fails = await recentFailures(ip); } catch { /* if lockout store is unreachable, fail closed below only on real auth */ }
      if (fails >= LOCK_MAX) return json(429, { ok: false, error: "locked_out" }, { "Retry-After": String(LOCK_WINDOW_MS / 1000) });

      const okUser = typeof body.username === "string" && Buffer.byteLength(body.username) === Buffer.byteLength(e.USER)
        && crypto.timingSafeEqual(Buffer.from(body.username), Buffer.from(e.USER));
      const okPass = auth.verifyPassword(String(body.password || ""), e.HASH);
      if (!okUser || !okPass) {
        await recordAttempt(ip, String(body.username || "").slice(0, 100), false);
        return json(401, { ok: false, error: "invalid_credentials" });
      }
      await recordAttempt(ip, e.USER, true);
      const token = auth.signSession(e.USER, e.SECRET, TTL_MS);
      return json(200,
        { ok: true, user: e.USER, csrfToken: auth.csrfToken(token, e.SECRET), expiresInSec: TTL_MS / 1000 },
        { "Set-Cookie": auth.sessionSetCookie(token, TTL_MS / 1000) });
    }

    if (route === "/auth/logout" && method === "POST") {
      return json(200, { ok: true }, { "Set-Cookie": auth.sessionClearCookie() });
    }

    if (route === "/auth/session" && method === "GET") {
      const s = requireSession(event);
      if (!s) return json(401, { ok: false, error: "unauthenticated" });
      return json(200, { ok: true, user: s.user, csrfToken: auth.csrfToken(s.token, e.SECRET) });
    }

    // ---------------- Everything below requires a session ----------------
    const s = requireSession(event);
    if (!s) return json(401, { ok: false, error: "unauthenticated" });

    // ----- reads (GET) -----
    if (route === "/listing-alerts" && method === "GET") {
      return json(200, { ok: true, data: await sbGet(LEAD_ALERTS_QUERY()) });
    }
    if (route === "/tasks" && method === "GET") {
      const sort = TASK_SORTS[qs.sort || "created"];
      if (!sort) return json(400, { ok: false, error: "bad_sort" });
      return json(200, { ok: true, data: await sbGet(`tasks?select=*&order=${sort}&limit=100`) });
    }
    if (route === "/agents" && method === "GET") {
      return json(200, { ok: true, data: await sbGet(`agents?select=id,name,email,phone,role&order=name.asc&limit=200`) });
    }
    if (route === "/deals" && method === "GET") {
      return json(200, { ok: true, data: await sbGet(`deals?select=id,lead_id,property,monthly_rent,stage,agent_id,notes,created_at&order=created_at.desc&limit=500`) });
    }
    if (route === "/commissions" && method === "GET") {
      return json(200, { ok: true, data: await sbGet(`commissions?select=id,deal_id,agent_id,amount,status,paid_at,created_at&order=created_at.desc&limit=500`) });
    }
    if (route === "/sequences" && method === "GET") {
      return json(200, { ok: true, data: await sbGet(`follow_up_sequences?select=*&order=name.asc&limit=100`) });
    }
    // AI call history for one lead, from the calls table written by call-recap.js.
    // Distinct from /vapi/calls, which proxies Vapi's own API and has no lead
    // association. Transcript is deliberately excluded from the list payload —
    // it can run to tens of KB per call and the CRM only renders the summary.
    if (route === "/calls" && method === "GET") {
      if (!validId(qs.lead_id)) return json(400, { ok: false, error: "bad_lead_id" });
      return json(200, { ok: true, data: await sbGet(`calls?select=id,lead_id,assistant,caller_phone,caller_name,direction,duration_sec,ended_reason,outcome,summary,evaluation,recording_url,flags,created_at&lead_id=eq.${encodeURIComponent(qs.lead_id)}&order=created_at.desc&limit=20`) });
    }
    if (route === "/activities" && method === "GET") {
      if (!validId(qs.lead_id)) return json(400, { ok: false, error: "bad_lead_id" });
      return json(200, { ok: true, data: await sbGet(`activities?select=id,lead_id,type,body,created_at&lead_id=eq.${encodeURIComponent(qs.lead_id)}&order=created_at.desc&limit=20`) });
    }
    if (route === "/leads" && method === "GET") {
      const mode = qs.mode || "list";
      // social.html: cross-client, optionally agent/client-filtered list & search.
      if (mode === "social-list" || mode === "social-search") {
        const agent = qs.agent;
        if (agent != null && agent !== "" && !validId(agent)) return json(400, { ok: false, error: "bad_agent" });
        const client = qs.client;
        if (client != null && client !== "" && !SOCIAL_CLIENTS.has(client)) return json(400, { ok: false, error: "bad_client" });
        const filters = [];
        if (client) filters.push(`client=eq.${encodeURIComponent(client)}`);
        if (agent) filters.push(`assigned_to=eq.${encodeURIComponent(agent)}`);
        if (mode === "social-search") {
          const q = sanitizeSearch(qs.q);
          if (!q) return json(400, { ok: false, error: "empty_query" });
          const enc = encodeURIComponent(q);
          filters.push(`or=(name.ilike.*${enc}*,email.ilike.*${enc}*,phone.ilike.*${enc}*)`);
        }
        const limit = mode === "social-search" ? 20 : 50;
        const query = `leads?${filters.length ? filters.join("&") + "&" : ""}order=created_at.desc&limit=${limit}&select=${SOCIAL_LEAD_SELECT}`;
        return json(200, { ok: true, data: await sbGet(query) });
      }
      const builder = LEAD_MODES[mode];
      if (!builder) return json(400, { ok: false, error: "bad_mode" });
      let query;
      if (mode === "search") {
        const q = sanitizeSearch(qs.q);
        if (!q) return json(400, { ok: false, error: "empty_query" });
        query = builder(encodeURIComponent(q));
      } else if (mode === "monitor-unreplied") {
        const since = clampSince(qs.since);
        query = builder(null, since);
      } else {
        query = builder();
      }
      return json(200, { ok: true, data: await sbGet(query) });
    }
    if (route === "/bookings" && method === "GET") {
      const builder = BOOKING_MODES[qs.mode || "recent"];
      if (!builder) return json(400, { ok: false, error: "bad_mode" });
      return json(200, { ok: true, data: await sbGet(builder()) });
    }
    if (route === "/system-health" && method === "GET") {
      let hours = parseInt(qs.hours || "24", 10);
      if (!Number.isFinite(hours) || hours < 1) hours = 24;
      if (hours > 168) hours = 168;
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const query = `system_health?select=tested_at,book_ok,readmail_ok,autocall_ok,inventory_ok,sms_key1_credits,sms_key2_credits,vapi_hangup_pct,errors&tested_at=gte.${since}&order=tested_at.desc&limit=24`;
      return json(200, { ok: true, data: await sbGet(query) });
    }
    if (route === "/inventory" && method === "GET") {
      const base = process.env.URL || (event.headers && `https://${event.headers.host}`) || "";
      const res = await fetch(`${base}/.netlify/functions/inventory`);
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return json(res.ok ? 200 : 502, { ok: res.ok, data });
    }
    if (route === "/vapi/calls" && method === "GET") {
      const vk = process.env.VAPI_KEY;
      if (!vk) return json(500, { ok: false, error: "server_not_configured" });
      // Allow-list query params: only `limit`, bounded to [1,100]. Anything else -> 400.
      for (const k of Object.keys(qs)) if (k !== "limit") return json(400, { ok: false, error: "bad_filter" });
      let limit = 100;
      if (qs.limit !== undefined) {
        limit = Number(qs.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json(400, { ok: false, error: "bad_filter" });
      }
      let res;
      try { res = await fetch(`https://api.vapi.ai/call?limit=${limit}`, { headers: { Authorization: `Bearer ${vk}` } }); }
      catch { return json(502, { ok: false, error: "provider_failed" }); }
      if (!res.ok) return json(502, { ok: false, error: "provider_failed" });
      let arr; try { arr = await res.json(); } catch { return json(502, { ok: false, error: "provider_failed" }); }
      if (!Array.isArray(arr)) arr = [];
      return json(200, { ok: true, data: arr.slice(0, limit).map(pickVapiCall) });
    }

    // ----- writes (require CSRF) -----
    if (route.startsWith("/tasks/") && method === "PATCH") {
      if (!requireCsrf(event, s.token)) return json(403, { ok: false, error: "csrf_failed" });
      const id = route.slice("/tasks/".length);
      if (!validId(id)) return json(400, { ok: false, error: "bad_id" });
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "invalid_json" }); }
      const spec = TASK_STATUSES[body.status];
      if (!spec) return json(400, { ok: false, error: "bad_status" });
      const patch = { status: spec.status };
      if (spec.stampField) patch[spec.stampField] = new Date().toISOString();
      await sbPatch(`tasks?id=eq.${encodeURIComponent(id)}`, patch);
      return json(200, { ok: true, task: { id, status: spec.status } });
    }
    // Manual stage change from the lead card. Records who moved it and when, so
    // an operator override is distinguishable from an automatic transition.
    if (route.startsWith("/leads/") && method === "PATCH") {
      if (!requireCsrf(event, s.token)) return json(403, { ok: false, error: "csrf_failed" });
      const id = route.slice("/leads/".length);
      if (!validId(id)) return json(400, { ok: false, error: "bad_id" });
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "invalid_json" }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { ok: false, error: "invalid_body" });

      // Allow-list. Anything not named here is ignored rather than rejected, so a
      // future UI field can't accidentally write to client, call_attempts or the
      // stage_changed_* audit columns. Same validators as POST /leads.
      const patch = {};
      try {
        if (body.status !== undefined) {
          if (!LEAD_STAGES.has(body.status)) return json(400, { ok: false, error: "bad_stage" });
          patch.status = body.status;
          patch.stage_changed_at = new Date().toISOString();
          patch.stage_changed_by = s.user || "operator";
        }
        if (body.name !== undefined) patch.name = vStr(body.name, 200, "name", true);
        if (body.email !== undefined) patch.email = body.email === "" ? null : vEmail(body.email, "email");
        if (body.phone !== undefined) patch.phone = body.phone === "" ? null : normalizePhone(body.phone);
        if (body.property !== undefined) patch.property = vStr(body.property, 500, "property", false);
        if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to === "" ? null : vId(body.assigned_to, "assigned_to");
        if (body.notes !== undefined) patch.notes = vStr(body.notes, 5000, "notes", false);
      } catch (e) {
        return json(400, { ok: false, error: e.message || "validation_failed" });
      }
      if (Object.keys(patch).length === 0) return json(400, { ok: false, error: "nothing_to_update" });

      // A phone that can't be normalised would silently become null and orphan the
      // lead from its text thread, so say so rather than accepting it.
      if (body.phone !== undefined && body.phone !== "" && !patch.phone) {
        return json(400, { ok: false, error: "bad_phone" });
      }

      await sbPatch(`leads?id=eq.${encodeURIComponent(id)}`, patch);
      return json(200, { ok: true, id, updated: Object.keys(patch) });
    }
    if (route.startsWith("/commissions/") && method === "PATCH") {
      if (!requireCsrf(event, s.token)) return json(403, { ok: false, error: "csrf_failed" });
      const id = route.slice("/commissions/".length);
      if (!validId(id)) return json(400, { ok: false, error: "bad_id" });
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "invalid_json" }); }
      const spec = COMMISSION_STATUSES[body.status];
      if (!spec) return json(400, { ok: false, error: "bad_status" });
      const patch = { status: spec.status, [spec.stampField]: new Date().toISOString() };
      await sbPatch(`commissions?id=eq.${encodeURIComponent(id)}`, patch);
      return json(200, { ok: true, id, status: spec.status });
    }

    // ----- CRM creates (require CSRF; field-level allow-list + validation) -----
    if ((route === "/leads" || route === "/deals" || route === "/tasks" || route === "/agents") && method === "POST") {
      if (!requireCsrf(event, s.token)) return json(403, { ok: false, error: "csrf_failed" });
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "invalid_json" }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { ok: false, error: "invalid_body" });
      let row, table;
      try {
        if (route === "/leads") {
          table = "leads";
          row = {
            name: vStr(body.name, 200, "name", true),
            email: vEmail(body.email, "email"),
            phone: normalizePhone(body.phone),
            source: vEnum(body.source, LEAD_SOURCES, "source", false),
            property: vStr(body.property, 500, "property", false),
            assigned_to: vId(body.assigned_to, "assigned_to"),
            notes: vStr(body.notes, 5000, "notes", false),
            client: "rosalia", status: "lead", // server-set, not client-controlled
          };
        } else if (route === "/deals") {
          table = "deals";
          row = {
            lead_id: vId(body.lead_id, "lead_id"),
            property: vStr(body.property, 500, "property", false),
            monthly_rent: vNum(body.monthly_rent, "monthly_rent"),
            stage: vEnum(body.stage, DEAL_STAGES, "stage", true),
            agent_id: vId(body.agent_id, "agent_id"),
            notes: vStr(body.notes, 5000, "notes", false),
          };
        } else if (route === "/tasks") {
          table = "tasks";
          row = {
            title: vStr(body.title, 300, "title", true),
            lead_id: vId(body.lead_id, "lead_id"),
            assigned_to: vId(body.assigned_to, "assigned_to"),
            due_date: vDate(body.due_date, "due_date"),
            priority: vEnum(body.priority, TASK_PRIORITIES, "priority", false) || "normal",
            description: vStr(body.description, 5000, "description", false),
            status: "pending", // server-set
          };
        } else {
          table = "agents";
          row = {
            name: vStr(body.name, 200, "name", true),
            email: vEmail(body.email, "email"),
            phone: normalizePhone(body.phone),
            role: vEnum(body.role, AGENT_ROLES, "role", false) || "leasing_agent",
          };
        }
      } catch (ve) {
        if (ve && ve._validation) return json(400, { ok: false, error: "invalid_field", field: ve._validation });
        throw ve;
      }
      const id = await sbPost(table, row);
      return json(200, { ok: true, id });
    }

    // ----- cancel-link SMS (require CSRF; fixed template; server-owned key) -----
    if (route === "/sms/cancel-link" && method === "POST") {
      if (!requireCsrf(event, s.token)) return json(403, { ok: false, error: "csrf_failed" });
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "invalid_json" }); }
      const phone = normalizePhone(body.phone);
      if (!phone) return json(400, { ok: false, error: "invalid_phone" });
      const url = String(body.url || "");
      if (!url.startsWith(CANCEL_LINK_PREFIX)) return json(400, { ok: false, error: "invalid_link" });
      const ip = auth.getClientIp(event);
      // duplicate-send protection (same number within window) + per-IP rate limit
      const dupSince = new Date(Date.now() - SMS_DUP_WINDOW_MS).toISOString();
      const rateSince = new Date(Date.now() - SMS_RATE_WINDOW_MS).toISOString();
      try {
        if (await smsRecentCount(`sms_sends?select=id&kind=eq.cancel-link&phone=eq.${encodeURIComponent(phone)}&sent_at=gte.${encodeURIComponent(dupSince)}`) > 0)
          return json(429, { ok: false, error: "duplicate_recent" });
        if (await smsRecentCount(`sms_sends?select=id&ip=eq.${encodeURIComponent(ip)}&sent_at=gte.${encodeURIComponent(rateSince)}`) >= SMS_RATE_MAX)
          return json(429, { ok: false, error: "rate_limited" });
      } catch { /* if the guard store is unreachable, do not block a legitimate send */ }
      const message = `Hi ${firstName(body.name)}, here is your appointment management link: ${url} — you can reschedule or cancel here.`;
      const provider = await sendSMS(phone, message, { optOut: true });
      // Record the attempt regardless (best-effort) for rate/dup tracking.
      fetch(`${e.URL}/rest/v1/sms_sends`, {
        method: "POST", headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify({ phone, kind: "cancel-link", ip }),
      }).catch(() => {});
      if (!provider || provider.success !== true) return json(502, { ok: false, error: "send_failed" });
      return json(200, { ok: true, data: { sent: true } });
    }

    // ----- actions (require CSRF; authed proxy to existing functions) -----
    if (route.startsWith("/actions/") && method === "POST") {
      if (!requireCsrf(event, s.token)) return json(403, { ok: false, error: "csrf_failed" });
      const name = route.slice("/actions/".length);
      if (!ACTIONS.has(name)) return json(400, { ok: false, error: "bad_action" });
      return await proxyAction(name, event);
    }

    return json(404, { ok: false, error: "not_found" });
  } catch (err) {
    console.error("api error on", method, route, "-", err && err.message);
    return json(502, { ok: false, error: "upstream_failed" });
  }
};

function LEAD_ALERTS_QUERY() { return `listing_alerts?select=*&order=received_at.desc&limit=50`; }
function clampSince(v) {
  const now = Date.now();
  let t = Date.parse(v);
  if (!Number.isFinite(t)) t = now - 24 * 3600 * 1000;
  const floor = now - 90 * 24 * 3600 * 1000; // clamp to <= 90 days back
  if (t < floor) t = floor;
  if (t > now) t = now;
  return new Date(t).toISOString();
}
