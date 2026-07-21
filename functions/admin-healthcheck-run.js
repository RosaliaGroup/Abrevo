/**
 * Authenticated manual healthcheck endpoint (Gate A).
 *
 * Path: /.netlify/functions/admin-healthcheck-run
 *
 * Unlike the scheduled wrapper (healthcheck.js), this endpoint is operator-only.
 * It authenticates with the shared Gate A auth helper owned by Session 2
 * (functions/lib/auth.js). That helper is NOT on this branch yet, so it is
 * required LAZILY and guarded: if it is absent the endpoint fails CLOSED (503)
 * rather than duplicating the auth implementation or bypassing it.
 *   DEPENDENCY: functions/lib/auth.js (Session 2) exporting
 *     sessionTokenFromEvent(event), verifySession(token, secret),
 *     verifyCsrf(sessionToken, provided, secret), header(event, name).
 *
 * Behavior:
 *   - Default is DRY-RUN (side-effect-free): runs the read-only worker and
 *     returns a bounded snapshot without writing anything.
 *   - dryRun:false persists a system_health row, and additionally requires a
 *     session-bound CSRF token (matching Session 2's state-changing convention).
 *
 * Output is bounded: never returns provider/Supabase/Google response bodies,
 * raw errors, stack traces, credentials, URLs with credentials, or inventory
 * contents.
 */

const worker = require('./_healthcheck-worker');

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (statusCode, obj) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) });

// Guarded, lazy load of Session 2's shared auth helper.
function loadAuth() {
  try {
    return require('./lib/auth');
  } catch (_) {
    return null;
  }
}

function wantsDryRun(event) {
  // Default true (safe). Only an explicit false disables it.
  const q = (event && event.queryStringParameters) || {};
  if (q.dryRun === 'false') return false;
  if (event && event.body) {
    try {
      const b = JSON.parse(event.body);
      if (b && b.dryRun === false) return false;
    } catch (_) {
      /* ignore malformed body — stays dry-run */
    }
  }
  return true;
}

/**
 * Core, dependency-injected handler (testable without Netlify or a real auth lib).
 * deps: { auth, worker, env }
 */
async function handleAdminHealthcheck(event, deps) {
  const auth = deps.auth;
  const runner = deps.worker || worker;
  const env = deps.env || process.env;

  const method = event && event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 200, headers: JSON_HEADERS, body: '' };

  const secret = env.OPERATOR_SESSION_SECRET;
  if (!auth || !secret) {
    // Fail closed: without the shared auth helper/secret we do NOT run an
    // unauthenticated privileged endpoint.
    return json(503, { error: 'auth_unavailable' });
  }

  const token = auth.sessionTokenFromEvent(event);
  const verdict = auth.verifySession(token, secret);
  if (!verdict || !verdict.ok) return json(401, { error: 'unauthorized' });

  const dryRun = wantsDryRun(event);

  if (!dryRun) {
    // State-changing (persists a row) -> require a session-bound CSRF token.
    const csrf = auth.header(event, 'X-CSRF-Token');
    if (!auth.verifyCsrf(token, csrf, secret)) return json(403, { error: 'csrf_invalid' });
  }

  const result = await runner.runHealthcheck({ env });

  let save = { saved: false, skipped: true };
  if (!dryRun) save = await runner.persistHealthResult(result, { env });

  const body = { ...result, dry_run: dryRun, saved: save.saved };
  if (save.error_code) body.save_error_code = save.error_code;
  return json(200, body);
}

exports.handler = async (event) =>
  handleAdminHealthcheck(event, { auth: loadAuth(), worker, env: process.env });

// Exported for unit tests.
exports.handleAdminHealthcheck = handleAdminHealthcheck;
exports.wantsDryRun = wantsDryRun;
