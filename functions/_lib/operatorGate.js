'use strict';
/**
 * Thin adapter over the EXISTING operator-auth library (functions/lib/auth.js).
 *
 * This module contains NO credential, crypto, or token-verification logic of its
 * own. It only COMPOSES the shared primitives already used by functions/api.js
 * (auth.verifySession / auth.verifyCsrf) with the same env secret
 * (OPERATOR_SESSION_SECRET), the same session cookie, and the same
 * `X-CSRF-Token` header convention. Keep it that way — do not add crypto here,
 * and do not fork a second authentication system.
 *
 * Semantics intentionally mirror api.js's private requireSession/requireCsrf:
 *   - reads the stateless HMAC-signed session from the __session cookie;
 *   - fails CLOSED (500 server_not_configured) if the secret is absent;
 *   - CSRF is required only for state-changing actions.
 */
const auth = require('../lib/auth');

function sessionSecret() {
  return process.env.OPERATOR_SESSION_SECRET || null;
}

/**
 * Verify the operator session on an incoming event.
 * @returns {{ok:true, token:string, user:string} | {ok:false, code:string, status:number}}
 */
function requireSession(event) {
  const secret = sessionSecret();
  if (!secret) return { ok: false, code: 'server_not_configured', status: 500 };
  const token = auth.sessionTokenFromEvent(event);
  const v = auth.verifySession(token, secret);
  if (!v.ok) return { ok: false, code: 'unauthenticated', status: 401 };
  return { ok: true, token, user: v.sub };
}

/**
 * Verify the session-bound CSRF token (X-CSRF-Token header) for a mutation.
 * Fails closed if the secret is absent.
 */
function requireCsrf(event, sessionToken) {
  const secret = sessionSecret();
  if (!secret) return false;
  return auth.verifyCsrf(sessionToken, auth.header(event, 'X-CSRF-Token'), secret);
}

module.exports = { requireSession, requireCsrf };
