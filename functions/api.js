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
};
const TASK_STATUSES = { resolved: { status: "resolved", resolvedField: "resolved_at" } };
const ACTIONS = new Set(["ai-generate", "ai-enrich", "autocall", "healthcheck"]);

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
      return json(200, { ok: true, data: await sbGet(`tasks?select=*&order=created_at.desc&limit=100`) });
    }
    if (route === "/leads" && method === "GET") {
      const mode = qs.mode || "list";
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

    // ----- writes (require CSRF) -----
    if (route.startsWith("/tasks/") && method === "PATCH") {
      if (!requireCsrf(event, s.token)) return json(403, { ok: false, error: "csrf_failed" });
      const id = route.slice("/tasks/".length);
      if (!validId(id)) return json(400, { ok: false, error: "bad_id" });
      let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "invalid_json" }); }
      const spec = TASK_STATUSES[body.status];
      if (!spec) return json(400, { ok: false, error: "bad_status" });
      const patch = { status: spec.status };
      if (spec.resolvedField) patch[spec.resolvedField] = new Date().toISOString();
      await sbPatch(`tasks?id=eq.${encodeURIComponent(id)}`, patch);
      return json(200, { ok: true, task: { id, status: spec.status } });
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
