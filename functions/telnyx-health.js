'use strict';
/**
 * Telnyx health / config diagnostic — NON-SENDING, OPERATOR-AUTHENTICATED.
 *
 * This handler reports whether the server-side Telnyx configuration is present
 * and well-formed (TELNYX_API_KEY present, TELNYX_FROM_NUMBER present + E.164).
 * That output reveals whether credentials EXIST, so it is an administrative
 * diagnostic and is protected by the Rosalia operator session gate (same gate as
 * functions/api.js). It is NOT a public endpoint.
 *
 * It does NOT: send an SMS, touch a conversation, make any Telnyx network call,
 * or expose any credential VALUE (booleans only).
 *
 * (A live read-only Telnyx account API check was considered and deferred: it is
 * unnecessary for a health signal and would add an external dependency/cost.
 * Config validation is sufficient and side-effect free.)
 */

const { createTelnyxClient } = require('./_lib/telnyx');
const { requireSession } = require('./_lib/operatorGate');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
function reply(statusCode, obj) { return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) }; }

// Factory so tests can inject a fake telnyx client. The operator gate is always
// exercised (not injected).
function makeHandler(deps = {}) {
  const makeClient = deps.makeClient || createTelnyxClient;

  return async (event) => {
    const method = String((event && event.httpMethod) || 'GET').toUpperCase();
    if (method !== 'GET') return reply(405, { ok: false, error: { code: 'method_not_allowed', message: 'GET only' } });

    const sess = requireSession(event);
    if (!sess.ok) {
      return reply(sess.status, { ok: false, error: {
        code: sess.code,
        message: sess.code === 'unauthenticated' ? 'authentication required' : 'server not configured',
      } });
    }

    const check = makeClient().configCheck(); // booleans only; no send, no network
    return reply(check.ok ? 200 : 503, check);
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
