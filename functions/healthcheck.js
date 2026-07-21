/**
 * Scheduled healthcheck wrapper (Gate A).
 *
 * Invoked by the Netlify scheduler (netlify.toml: schedule "0 * * * *").
 * Scheduled invocations run WITHOUT browser/admin auth by design — this wrapper
 * must not require a session.
 *
 * This replaces the legacy healthcheck, which:
 *   - POSTed to readmail / autocall / inventory (triggering LIVE calls, SMS, and
 *     email processing during business hours),
 *   - mapped mere liveness to *_ok:true,
 *   - reported "healthy" while execution states were actually unknown,
 *   - sent alert emails/SMS, and
 *   - never checked response.ok on its Supabase write.
 *
 * The new wrapper delegates to a side-effect-free worker (reads only, no
 * operational-function invocation, no alerts) and performs the single
 * pre-existing, proven-safe write (system_health insert) via persistHealthResult.
 */

const { runHealthcheck, persistHealthResult } = require('./_healthcheck-worker');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const result = await runHealthcheck(); // reads only — no side effects
  const persisted = await persistHealthResult(result); // the only write

  const body = { ...result, saved: persisted.saved };
  if (persisted.error_code) body.save_error_code = persisted.error_code;

  return { statusCode: 200, headers, body: JSON.stringify(body) };
};
