// ============================================================================
// _gate-a-auth.js  —  GATE A shared guard for admin Netlify Functions [v3]
// ----------------------------------------------------------------------------
// TEMPORARY containment. NOT durable Supabase Auth (Gate B).
//
// v3 changes:
//   - Dev bypass ONLY when process.env.CONTEXT === 'dev' (never preview/branch).
//   - OPTIONS no longer returns {ok:true}. It returns {ok:false, response:<preflight>}
//     so the handler STOPS and never reaches provider/DB/admin work. The response
//     is a harmless CORS preflight (204) using the admin CORS allowlist.
//   - Never accepts the Supabase service-role key as auth. Never logs credentials.
//   - DEFAULT DENY on missing config. Timing-safe comparison.
//
// Usage:
//   const { requireGateA, adminCorsHeaders } = require('./_gate-a-auth');
//   exports.handler = async (event) => {
//     const gate = requireGateA(event);
//     if (!gate.ok) return gate.response;   // handles OPTIONS preflight AND 401/403
//     ... admin logic ...
//   };
// ============================================================================

const crypto = require('crypto');

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(Buffer.from(String(a), 'utf8')).digest();
  const hb = crypto.createHash('sha256').update(Buffer.from(String(b), 'utf8')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseBasic(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'basic') return null;
  let decoded;
  try { decoded = Buffer.from(parts[1], 'base64').toString('utf8'); } catch { return null; }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

// Admin CORS: never wildcard. Allowlist from env (fill real dashboard origin in A0).
function adminCorsHeaders(event) {
  const allow = (process.env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const origin = (event && event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = allow.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };
}

// Dev bypass ONLY in true local dev. Preview/branch/production never bypass.
function allowDevBypass() {
  return process.env.CONTEXT === 'dev' && process.env.GATE_A_DEV_BYPASS === 'true';
}

function deny(statusCode, event) {
  const headers = adminCorsHeaders(event);
  if (statusCode === 401) headers['WWW-Authenticate'] = 'Basic realm="Rosalia Admin (Gate A)"';
  const msg = statusCode === 401 ? 'Authentication required' : 'Forbidden';
  return { ok: false, response: { statusCode, headers, body: JSON.stringify({ error: msg }) } };
}

/**
 * requireGateA(event) -> { ok:true } | { ok:false, response }
 * Returns a stopping response for OPTIONS (harmless 204 preflight), missing/invalid
 * config or credentials (401), and wrong credentials (403). Never returns ok:true
 * for an unauthenticated request.
 */
function requireGateA(event) {
  // Preflight: STOP here with a harmless CORS response. Do NOT continue to logic.
  if (event && event.httpMethod === 'OPTIONS') {
    return { ok: false, response: { statusCode: 204, headers: adminCorsHeaders(event), body: '' } };
  }

  if (allowDevBypass()) return { ok: true, dev: true };

  const expectedUser = process.env.ADMIN_GATE_USER;
  const expectedPass = process.env.ADMIN_GATE_PASS;
  if (!expectedUser || !expectedPass) return deny(401, event); // default deny

  const authHeader = (event && event.headers &&
    (event.headers.authorization || event.headers.Authorization)) || null;
  const creds = parseBasic(authHeader);
  if (!creds) return deny(401, event);

  const userOk = timingSafeEqualStr(creds.user, expectedUser);
  const passOk = timingSafeEqualStr(creds.pass, expectedPass);
  if (userOk && passOk) return { ok: true };
  return deny(403, event);
}

module.exports = { requireGateA, adminCorsHeaders };
