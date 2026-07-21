/**
 * Private, side-effect-free healthcheck worker (Gate A).
 *
 * Shared by BOTH the scheduled wrapper (healthcheck.js) and the authenticated
 * manual endpoint (admin-healthcheck-run.js). The leading underscore keeps
 * Netlify from routing this as its own function.
 *
 * WHAT THIS DOES NOT DO (by design — see Gate A findings):
 *  - It NEVER POSTs to / invokes readmail, autocall, inventory, or any SMS /
 *    email / call / campaign / booking function. The legacy healthcheck POSTed
 *    to readmail & autocall, which literally triggered live calls, SMS, and
 *    email processing during business hours. That is removed.
 *  - It NEVER sends alert emails or SMS.
 *  - runHealthcheck() performs READS ONLY (GET). The single permitted write —
 *    the pre-existing system_health insert — lives in persistHealthResult(),
 *    which is called ONLY by the scheduled wrapper (or an explicit,
 *    authenticated, non-dry-run manual run). Dry-run never writes.
 *
 * SCHEDULER EXECUTION SEMANTICS:
 *  Neither readmail nor autocall writes a successful per-invocation heartbeat
 *  (verified in source: autocall has no health/heartbeat write; readmail only
 *  writes system_logs on error/warn, never a success record). Therefore their
 *  execution state is reported as "unknown" and is kept SEPARATE from
 *  business-activity freshness (leads.replied_at / leads.last_call_at), which
 *  reflect completed business actions, not scheduler execution. Unknown is
 *  never mapped to true / "healthy" / *_ok:true.
 */

const DEFAULT_SUPABASE_URL = 'https://fhkgpepkwibxbxsepetd.supabase.co';

// Business-activity freshness windows (hours). Used ONLY to compute an
// informational *_activity_fresh flag — never to raise an urgent alert.
const READMAIL_FRESH_HOURS = 24;
const AUTOCALL_FRESH_HOURS = 24;

function envOf(opts) {
  return (opts && opts.env) || process.env;
}
function fetchOf(opts) {
  return (opts && opts.fetch) || fetch;
}
function nowMs(opts) {
  return typeof (opts && opts.now) === 'number' ? opts.now : Date.now();
}

// ---- Individual read-only probes (each returns a bounded shape, never throws) ----

async function checkTextbelt(doFetch, key, label) {
  if (!key) return { label, credits: -1, checked: false };
  try {
    const r = await doFetch(`https://textbelt.com/quota/${encodeURIComponent(key)}`);
    if (!r.ok) return { label, credits: -1, checked: true };
    const data = await r.json();
    const credits = Number(data && data.quotaRemaining);
    return { label, credits: Number.isFinite(credits) ? credits : -1, checked: true };
  } catch (_) {
    return { label, credits: -1, checked: true };
  }
}

async function checkVapi(doFetch, env, opts) {
  const key = env.VAPI_KEY;
  if (!key) return { ok: false, calls_today: 0, voicemail_pct: 0, hangup_pct: 0 };
  try {
    const now = new Date(nowMs(opts));
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const r = await doFetch(`https://api.vapi.ai/call?createdAtGe=${todayStart}&limit=100`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return { ok: false, calls_today: 0, voicemail_pct: 0, hangup_pct: 0 };
    const calls = await r.json();
    const list = Array.isArray(calls) ? calls : [];
    const total = list.length;
    const voicemail = list.filter((c) => c && c.endedReason === 'voicemail').length;
    const hangup = list.filter((c) => c && c.endedReason === 'customer-ended-call').length;
    return {
      ok: true,
      calls_today: total,
      voicemail_pct: total ? Math.round((voicemail / total) * 100) : 0,
      hangup_pct: total ? Math.round((hangup / total) * 100) : 0,
    };
  } catch (_) {
    return { ok: false, calls_today: 0, voicemail_pct: 0, hangup_pct: 0 };
  }
}

function sbUrl(env) {
  return env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
}
function sbHeaders(env) {
  const key = env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

// Read-only Supabase reachability probe (HEAD-like GET, 1 row, minimal columns).
async function checkSupabase(doFetch, env) {
  if (!env.SUPABASE_SERVICE_KEY) return { ok: false, reason: 'no_key' };
  try {
    const r = await doFetch(`${sbUrl(env)}/rest/v1/leads?select=id&limit=1`, {
      headers: sbHeaders(env),
    });
    return { ok: !!r.ok };
  } catch (_) {
    return { ok: false };
  }
}

// Business-activity freshness (NOT scheduler execution). Returns:
//   true  -> a qualifying business action occurred within the window
//   false -> none within the window
//   null  -> could not determine (read failed / no key)  [treated as unknown, never an issue]
async function activityFresh(doFetch, env, column, windowHours, opts) {
  if (!env.SUPABASE_SERVICE_KEY) return null;
  try {
    const r = await doFetch(
      `${sbUrl(env)}/rest/v1/leads?select=${column}&${column}=not.is.null&order=${column}.desc&limit=1`,
      { headers: sbHeaders(env) }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0 || !rows[0] || !rows[0][column]) return false;
    const ts = Date.parse(rows[0][column]);
    if (!Number.isFinite(ts)) return null;
    return nowMs(opts) - ts <= windowHours * 60 * 60 * 1000;
  } catch (_) {
    return null;
  }
}

/**
 * Run the full side-effect-free healthcheck. READS ONLY — never writes, never
 * invokes an operational function. Returns a bounded, serialization-safe object.
 *
 * opts.env, opts.fetch, opts.now, opts.inventoryCheck are injectable for tests.
 */
async function runHealthcheck(opts = {}) {
  const env = envOf(opts);
  const doFetch = fetchOf(opts);
  const inventoryCheck =
    (opts && opts.inventoryCheck) ||
    ((o) => require('./_inventory-check').runInventoryCheck(o));

  const [sms1, sms2, vapi, supabase, inventory, readmailFresh, autocallFresh] = await Promise.all([
    checkTextbelt(doFetch, env.TEXTBELT_KEY, 'key1'),
    checkTextbelt(doFetch, env.TEXTBELT_KEY_2, 'key2'),
    checkVapi(doFetch, env, opts),
    checkSupabase(doFetch, env),
    Promise.resolve()
      .then(() => inventoryCheck({ env }))
      .catch(() => ({ ok: false, error_code: 'inventory_sheet_read_failed' })),
    activityFresh(doFetch, env, 'replied_at', READMAIL_FRESH_HOURS, opts),
    activityFresh(doFetch, env, 'last_call_at', AUTOCALL_FRESH_HOURS, opts),
  ]);

  // ---- Hard issues (bounded strings only; no raw provider/error text) ----
  const issues = [];
  if (!supabase.ok) issues.push('supabase_unreachable');
  if (!inventory.ok) issues.push(inventory.error_code || 'inventory_check_failed');
  if (!vapi.ok) issues.push('vapi_check_failed');
  if (vapi.ok && vapi.hangup_pct > 50) issues.push('vapi_hangup_rate_high');
  if (sms1.checked && sms1.credits < 0) issues.push('sms_key1_check_failed');
  if (sms2.checked && sms2.credits < 0) issues.push('sms_key2_check_failed');
  if (sms1.checked && sms1.credits >= 0 && sms1.credits < 500) issues.push('sms_key1_low');
  if (sms2.checked && sms2.credits >= 0 && sms2.credits < 200) issues.push('sms_key2_low');

  // NOTE: readmail/autocall execution being "unknown" and activity not being
  // fresh are deliberately NOT issues. We never alert solely because there is
  // no recent lead reply or call.

  // Overall status is bounded and NEVER "healthy": material execution states
  // (readmail/autocall) are always unknown in this architecture.
  const status = issues.length ? 'issues' : 'no_detected_issues';

  return {
    tested_at: new Date(nowMs(opts)).toISOString(),
    status,

    // Genuinely determinable states:
    supabase_ok: supabase.ok,
    inventory_ok: inventory.ok === true,
    inventory_error_code: inventory.ok ? null : inventory.error_code || 'inventory_check_failed',

    // Scheduler execution: UNKNOWN (no heartbeat exists). Never true / "ok".
    readmail_execution: 'unknown',
    autocall_execution: 'unknown',

    // Business-activity freshness — SEPARATE from execution, informational only.
    readmail_activity_fresh: readmailFresh,
    autocall_activity_fresh: autocallFresh,

    // Bounded metrics:
    sms_key1_credits: Math.max(sms1.credits, 0),
    sms_key2_credits: Math.max(sms2.credits, 0),
    vapi_calls_today: vapi.calls_today,
    vapi_voicemail_pct: vapi.voicemail_pct,
    vapi_hangup_pct: vapi.hangup_pct,

    issues: issues.length ? issues : null,
  };
}

/**
 * Persist a health result to the pre-existing system_health table.
 * This is the ONLY write in this module and is invoked only by the scheduled
 * wrapper (or an explicit authenticated, non-dry-run manual run).
 *
 * Unknown execution states are written as NULL (the schema's *_ok columns are
 * nullable) — NEVER as a false "healthy" value. Every request checks
 * response.ok and returns a bounded result; raw response bodies are never read
 * or returned.
 */
async function persistHealthResult(record, opts = {}) {
  const env = envOf(opts);
  const doFetch = fetchOf(opts);
  const key = env.SUPABASE_SERVICE_KEY;
  if (!key) return { saved: false, error_code: 'health_write_no_key' };

  const row = {
    tested_at: record.tested_at,
    // Unknown execution -> NULL (never true, never a false "healthy"):
    book_ok: null, // no longer probed (probing book invoked an operational fn)
    readmail_ok: null, // execution unknown
    autocall_ok: null, // execution unknown
    // Genuinely determined:
    inventory_ok: record.inventory_ok === true ? true : record.inventory_ok === false ? false : null,
    sms_key1_credits: record.sms_key1_credits,
    sms_key2_credits: record.sms_key2_credits,
    vapi_calls_today: record.vapi_calls_today,
    vapi_voicemail_pct: record.vapi_voicemail_pct,
    vapi_hangup_pct: record.vapi_hangup_pct,
    errors: record.issues && record.issues.length ? record.issues : null,
  };

  let res;
  try {
    res = await doFetch(`${sbUrl(env)}/rest/v1/system_health`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch (_) {
    return { saved: false, error_code: 'health_write_network' };
  }
  if (!res.ok) {
    // Bounded code only (e.g. health_write_400). Never read/return the body —
    // and never retry with false "healthy" values on a schema mismatch.
    return { saved: false, error_code: `health_write_${res.status}` };
  }
  return { saved: true };
}

module.exports = { runHealthcheck, persistHealthResult, DEFAULT_SUPABASE_URL };
