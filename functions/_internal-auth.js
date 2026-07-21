// ============================================================================
// _internal-auth.js  —  server-to-server INTERNAL_TOKEN guard [v3]
// ----------------------------------------------------------------------------
// For endpoints that a trusted non-browser caller must reach (e.g. Vapi
// server-messages, or one function calling another). NEVER exposed to browser JS.
// Timing-safe. Default-deny. Never logs the token.
//
// Usage:
//   const { requireInternalToken } = require('./_internal-auth');
//   exports.handler = async (event) => {
//     if (event.httpMethod === 'OPTIONS')
//       return { statusCode: 204, headers: NO_CORS, body: '' };
//     const gate = requireInternalToken(event);
//     if (!gate.ok) return gate.response;
//     ... logic ...
//   };
// ============================================================================

const crypto = require('crypto');

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(Buffer.from(String(a), 'utf8')).digest();
  const hb = crypto.createHash('sha256').update(Buffer.from(String(b), 'utf8')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// These endpoints are not browser-facing; do not advertise CORS to any origin.
const NO_CORS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function requireInternalToken(event) {
  const expected = process.env.INTERNAL_TOKEN;
  if (!expected) {
    return { ok: false, response: { statusCode: 401, headers: NO_CORS,
      body: JSON.stringify({ error: 'internal auth not configured' }) } };
  }
  const got = (event && event.headers &&
    (event.headers['x-internal-token'] || event.headers['X-Internal-Token'])) || '';
  if (!got || !timingSafeEqualStr(got, expected)) {
    return { ok: false, response: { statusCode: 401, headers: NO_CORS,
      body: JSON.stringify({ error: 'invalid internal token' }) } };
  }
  return { ok: true };
}

module.exports = { requireInternalToken, NO_CORS };
