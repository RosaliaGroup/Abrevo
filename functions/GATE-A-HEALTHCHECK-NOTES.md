# Gate A — Healthcheck & Inventory Safety (Session 3)

Scope: healthcheck + inventory-safety only. Findings below are derived from source, not assumptions.

## Verified findings

1. **readmail successful-invocation heartbeat?** — **NO.** `readmail.js` only writes to
   `system_logs` via `syslog()` at `error`/`warn` levels (never a success record) and writes
   business rows/`last_contact_at` as a side effect of processing. There is no per-invocation
   "readmail ran successfully" heartbeat. → execution state = **unknown**.
2. **autocall successful-invocation heartbeat?** — **NO.** `autocall.js` writes no `system_health`
   / `system_logs` / heartbeat at all. It only writes `leads.last_call_at` when a call is actually
   placed. → execution state = **unknown**.
3. **Do activity timestamps represent execution or completed business actions?** — **completed
   business actions.** `leads.replied_at` (readmail) and `leads.last_call_at` (autocall) are written
   only when the business action happens; they are NOT scheduler-execution proof. They are surfaced
   as separate, informational `*_activity_fresh` flags and never described as scheduler health.
4. **Do existing health columns permit null?** — **YES.** The `system_health` schema (embedded as a
   `CREATE TABLE` in the dashboard's `loadHealthHistory`) declares all `*_ok` columns as nullable
   `boolean` with no NOT NULL / default. So unknown execution is persisted as `null`.
5. **Do inventory reads have side effects?** — **NO.** `inventory.js` uses the read-only scope and
   only `spreadsheets.get` + `values.get`. Read-only.
6. **Does any current healthcheck path call operational functions?** — **YES (the core bug).** The
   legacy `healthcheck.js` `POST`ed `{}` to `readmail`, `autocall`, and `inventory` and mapped
   liveness to `*_ok:true`. Because `autocall`/`readmail` have no method/auth/dry-run guard, this
   **triggered live Vapi calls, SMS, and inbox processing during business hours** on every run, and
   also sent alert emails/SMS. All of that is removed.

## What this change does

- `functions/_healthcheck-worker.js` — private, side-effect-free worker (reads only: Textbelt quota,
  Vapi list, Supabase reachability, inventory reachability, activity freshness). Never POSTs, never
  invokes operational functions, never alerts. Plus `persistHealthResult()` — the only writer
  (system_health insert), checks `response.ok`, returns bounded `{saved}` / `{saved:false,error_code}`.
- `functions/healthcheck.js` — scheduled wrapper (unauth, as required by the Netlify scheduler);
  runs the worker then persists.
- `functions/admin-healthcheck-run.js` — authenticated manual endpoint. Uses Session 2's shared
  auth helper (`functions/lib/auth.js`) via a guarded lazy require; **fails closed (503)** if the
  helper/secret is absent. Dry-run by default (side-effect-free); non-dry-run persists and also
  requires a session-bound CSRF token.
- `functions/_inventory-check.js` — private read-only inventory helper. Credentials from
  `GOOGLE_SHEETS_CREDENTIALS` env (no hardcoded key). Returns only `{ok,sheet_count}` or bounded
  `error_code`; never returns rows, headers, spreadsheet IDs, credentials, or raw Google errors.
- `healthcheck-ui.js` + `rosalia.html` — the manual UI calls the authenticated endpoint, handles
  401/403/non-2xx/non-JSON before parsing, shows readmail/autocall execution as **Unknown**
  (never OK/FAIL), and never prints "healthy" while execution is unknown.

## Out-of-scope finding (NOT fixed here — flagged for the owner / Session 2)

`rosalia.html` monitor dashboard (`monLoadAutocall`/`monLoadReadmail`, called by
`monitorRefreshAll` every 60s) does `fetch(AUTOCALL_URL)` / `fetch(READMAIL_URL)` — i.e. it GETs
`autocall`/`readmail`, which (no method guard) **also triggers live calls/SMS/email** while the
Monitor tab is open. This is the same vulnerability class as the healthcheck bug but lives in the
monitor path (unrelated dashboard behavior / likely another session's ownership), so it is left
untouched and reported here. It should be addressed separately.

## Prohibited legacy secret (context)

`functions/inventory.js` still contains a hardcoded Google service-account private key. This change
does not modify `inventory.js` (it is a live operational endpoint, out of the healthcheck's write
scope), but the new `_inventory-check.js` deliberately uses `GOOGLE_SHEETS_CREDENTIALS` instead.
Rotating/removing the embedded key in `inventory.js` is a separate remediation.
