# Gate A — Local Verification (Session 1, read-only)

**Scope:** Read-only local verification and classification of the RosaliaGroup/Abrevo
repository and its actual production deployment. No application code was modified; no
deploy, rotation, send, or DB write was performed. All credentials are redacted.

**Date:** 2026-07-20
**Verifier role:** Session 1 (local verification + classification only)

---

## 0. First Record — repository & deployment identity

| Item | Value |
|---|---|
| Working copy path | `C:\Users\ana\Abrevo-phase0` (linked git worktree) |
| Real gitdir | `C:/Users/ana/OneDrive/Desktop/Abrevo-Clean/.git/worktrees/Abrevo-phase0` |
| Branch at start of session | `fix/phase0-neutralize-client-textbelt` |
| HEAD SHA at start of session | `f248fc0341c58201aecb883d5fb2f50643b2f858` |
| `git status --short` at start | *(clean — no output)* |
| Remote (`origin`) | `https://github.com/RosaliaGroup/Abrevo.git` |
| Repository visibility | **PUBLIC** (`"private": false`, `"visibility":"public"` via GitHub API; unauthenticated `git ls-remote` succeeds) |
| `origin/main` (production ref) | `910ab2c9b5571716bdf9236875261d0f3b01703b` |
| GitHub public HEAD | `910ab2c…` (identical to `origin/main`) |
| Start branch vs `origin/main` | 5 ahead / 0 behind (Phase 0/1/2 SMS work, unmerged) |
| Netlify site (from repo docs) | `silver-ganache-1ee2ca.netlify.app` |
| Production custom domain | `app.abrevo.co` (`netlify.toml` → `context.production.environment.DOMAIN`) |
| Functions directory (deployed) | `functions/` (`netlify.toml` → `[build] functions = "functions"`) |
| Publish/build | Static site root + Netlify Functions; `node_bundler = "esbuild"` (scheduled fns use `nft`) |

> The report itself is authored on a dedicated branch `security/gate-a-local-verification`
> based on `origin/main` (`910ab2c`), i.e. the exact production tree. `main` was not edited.

---

## VERIFIED

### V1 — Production deploys this repository's `main`
- `origin/main` = GitHub public HEAD = `910ab2c`.
- Live production (`https://app.abrevo.co/…`) returns HTTP 200 and serves the **same
  files** committed on `main`, confirmed by fetching `crm.html`, `rosalia.html`,
  `mechanical.html` and matching the embedded Supabase project ref and credential shape
  (see V2). This is empirical proof the Netlify production site builds this repo/branch.
- `netlify.toml` is byte-identical between `origin/main` and the Phase 0 branch (no config drift).

### V2 — Browser-delivered files containing privileged credentials (production `main`)
Each of the following **static HTML files served to the browser** embeds a **full Supabase
`service_role` JWT** (role claim decoded = `service_role`) for the same Supabase project
(ref `fhkgpe…petd`). A `service_role` key bypasses Row Level Security — full read/write to
the database. Verified live on production for the three admin pages tested.

| Browser file | On `main` (prod) | Live prod check | Embedded role |
|---|---|---|---|
| `crm.html` | service_role JWT | HTTP 200, JWT present, role=`service_role` | service_role |
| `rosalia.html` | service_role JWT | HTTP 200, JWT present, role=`service_role` | service_role |
| `mechanical.html` | service_role JWT | HTTP 200, JWT present, role=`service_role` | service_role |
| `social.html` | service_role JWT | *(not fetched; git-verified on main)* | service_role |
| `cancel-reschedule.html` | service_role JWT | *(not fetched; git-verified on main)* | service_role |

Because the GitHub repo is **public** (V0/§0), these keys are also readable directly from
source history, not only from the served pages.

### V3 — Hardcoded server-side secrets committed in source (public repo)
- `functions/inventory.js` — hardcoded **Google service-account private key**
  (`-----BEGIN PRIVATE KEY-----`), `client_email
  abrevo-sheets@abrevo-booking.iam.gserviceaccount.com`, `private_key_id` present.
  Committed in cleartext; public repo. *(value redacted)*
- `ROSALIA-SYSTEM-GUIDE.md` — leaks the **Vapi private key** (env `VAPI_KEY`) and
  `VAPI_PHONE_ID` as literals in a committed doc. *(values redacted)*
- Legacy duplicate tree `netlify/functions/*` and multiple `backups/*` and
  `ABREVO-FINAL-BACKUP-*` trees embed **hardcoded Supabase JWTs** in
  `lookup.js`, `respondrosalia.js`, `reschedule.js`, `cincwebhook.js`, `followup.js`,
  `phoneupdated.js`. These directories are **not** the deployed function dir but are
  public in the repo.

### V4 — Additional admin page beyond the four named
- The four named admin pages exist: `rosalia.html`, `crm.html`, `social.html`, `mechanical.html`.
- **One additional admin/privileged UI page exists: `communications.html`** (Phase 2 SMS
  inbox UI). It does **not** embed a JWT; it calls the server wrapper
  `/.netlify/functions/communications`. **It exists only on the Phase 0 branch and is
  ABSENT on `origin/main`** — i.e. not in production.
- No other credential-bearing or admin HTML page was found beyond these five.

### V5 — Callers of `lookup`
- **No in-repo caller** references `lookup` by name or by path (`/.netlify/functions/lookup`)
  in any deployed function or any HTML page. The only in-repo hits are unrelated
  substring matches (comments, `lead lookup` log strings in `readmail.js`, and the
  `_lib/conversations.js` service description).
- `functions/lookup.js` is a Netlify HTTP function: `exports.handler`, `httpMethod`
  handling, `Access-Control-Allow-Origin: '*'`, **no inbound authentication**. It queries
  the Supabase `bookings` table by phone using `process.env.SUPABASE_SERVICE_KEY`.
- Classification: **externally-invoked HTTP endpoint** — reachable by any client, and used
  by Vapi as the caller-info / booking-lookup tool during calls (see V8). Its callers are
  external (Vapi + direct URL), not in-repo.

### V6 — Marketing-route classifications (all are static rewrites in `netlify.toml`)
| Route | `netlify.toml` target | Status | Backend? | Credentials? | Classification |
|---|---|---|---|---|---|
| `/book-demo` | `/book-demo.html` | 200 (rewrite) | none (static) | none | Public static demo-booking page |
| `/book/florostone` | `/book-demo.html?client=florostone` | 200 | none | none | Public static (client-param variant of book-demo) |
| `/florostone` | `/florostone.html` | 200 | none | none | Public static client landing page |
| `/listings/:slug` | `/listings/:slug.html` | 200 | none | none | Public static listing page (slug → static file; only `422-faitoute-ave.html` exists) |
| `/tour/:slug` | `/tour/:slug.html` | 200 | none | none | Public static tour page (only `422-faitoute-ave.html` exists) |

The `:slug` routes **look dynamic but are static-file rewrites** — Netlify maps the slug to
a same-named `.html` file; there is no serverless handler behind them. None of the four
marketing pages embed a JWT (verified `JWT-count=0` each).

### V7 — `hvac-outreach` classification
- `functions/hvac-outreach.js` **exists on `origin/main` (deployed)**.
- The file's header comment says *"Netlify scheduled function — can also be triggered
  manually from dashboard."* **This is inaccurate:** it is **NOT** listed in `netlify.toml`
  schedules and has **NO inline `export const config = { schedule }`**. It is therefore
  **not actually scheduled**.
- It is an HTTP function (`exports.handler`, `httpMethod`, `Access-Control-Allow-Origin:'*'`,
  **no inbound auth**) that reads `hvac_leads` and, per lead, triggers a **Vapi outbound
  call + SMS + email**. Uses env: `SUPABASE_SERVICE_KEY`, `VAPI_KEY`, `TEXTBELT_KEY`,
  `ANTHROPIC_API_KEY`, `HVAC_ASSISTANT_ID`.
- **No in-repo dashboard button or caller** references `hvac-outreach` (no HTML/JS hit).
- **Net classification:** a **deployed, unauthenticated, manually/URL-invocable HTTP
  endpoint** with real side effects (calls/SMS/email). It is **not scheduled**, and its
  "dashboard trigger" is **not wired in this repo**. Effective trigger surface = direct HTTP
  (manual) only. (It is a combination of *manually invocable* + *misdocumented as scheduled*.)

### V8 — Real callers & config sources for the named functions (deployed `functions/`)
All five deployed functions set `Access-Control-Allow-Origin: '*'` and perform **no inbound
authentication** (no `X-Internal-Token`, no `VAPI_TOOL_SECRET`, no signature/token check,
no 401/403 path). The `Authorization`/`apikey` headers present in them are **outbound** to
Supabase / Vapi / Anthropic, not inbound checks.

| Function | Real caller(s) | Config sources (env unless noted) | Inbound auth |
|---|---|---|---|
| `lookup` | External: Vapi call tool + direct URL | `SUPABASE_URL` (hardcoded project URL), `SUPABASE_SERVICE_KEY` | **none** (CORS `*`) |
| `sendcallrecap` | External: Vapi (end-of-call recap) + direct URL | *(53-line HTTP fn; Supabase/Textbelt via env in siblings)* | **none** |
| `respondrosalia` | External: email/AI responder + direct URL | `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_KEY`, `TEXTBELT_KEY`, `GMAIL_USER`, `GMAIL_PASS_INQUIRIES`/`GMAIL_PASS` | **none** |
| `sendemail` | External / direct URL | nodemailer Gmail (`GMAIL_USER=inquiries@rosaliagroup.com`, `GMAIL_PASS_INQUIRIES`), `SUPABASE_SERVICE_KEY` | **none** |
| `hvac-outreach` | Direct URL / manual (see V7) | `SUPABASE_SERVICE_KEY`, `VAPI_KEY`, `TEXTBELT_KEY`, `ANTHROPIC_API_KEY`, `HVAC_ASSISTANT_ID` | **none** |

`X-Internal-Token` appears **nowhere** in the deployed functions or any HTML — the
"internal token" auth pattern does not exist in this codebase.

### V9 — Netlify scheduled functions (authoritative: `netlify.toml`)
Exactly eight scheduled functions are declared; **`hvac-outreach` is not among them**:

| Function | Schedule (cron) | Meaning |
|---|---|---|
| `readmail` | `* * * * *` | every minute |
| `fubsync` | `* * * * *` | every minute |
| `autocall` | `* * * * *` | every minute |
| `healthcheck` | `0 * * * *` | hourly |
| `sendsurvey` | `0 22 * * *` | daily 22:00 UTC |
| `followup` | `0 10 * * *` | daily 10:00 UTC |
| `appointment-reminder` | `0 14 * * *` | daily 14:00 UTC |
| `appointment-reminder-evening` | `0 0 * * *` | daily 00:00 UTC |

No inline (`export const config.schedule`) schedules were found in `hvac-outreach.js`.

---

## INFERENCE

- **I1 (Vapi ↔ endpoints):** `lookup`, `sendcallrecap`, and `respondrosalia` are the
  endpoints Vapi calls (caller-info lookup, end-of-call recap, AI response). This is
  inferred from the function purposes + the Vapi assistant inventory in
  `ROSALIA-SYSTEM-GUIDE.md`; the exact Vapi tool→URL bindings live in the external Vapi
  dashboard, not in the repo.
- **I2 (Vapi auth):** Because every relevant endpoint accepts unauthenticated requests
  (CORS `*`, no token/signature check), Vapi is **not required** to send authentication, and
  the endpoints would not enforce it if it did. Whether the current Vapi dashboard config
  attaches any header is external and not verifiable locally (see Unresolved U1).
- **I3 (blast radius):** A single leaked `service_role` key (same project ref across all
  five browser files) means any visitor to those pages — or any reader of the public repo —
  obtains full RLS-bypass DB access. The exposure is live in production (V1/V2).
- **I4 (Phase 0 incompleteness):** The Phase 0 branch removed the `service_role` key from
  `crm.html` only. `rosalia.html`, `mechanical.html`, `social.html`, and
  `cancel-reschedule.html` **still embed `service_role`** even on that branch — remediation
  is partial there and absent in production.

---

## UNRESOLVED

- **U1 — Netlify dashboard binding & env:** No `.netlify/state.json`, no `netlify link`, and
  no Netlify CLI available. The repo→site binding and production branch are **inferred** from
  `netlify.toml` + the live-serve match (V1), not read from the Netlify dashboard. Actual env
  var values (and whether any Vapi-side secret exists) were not read.
- **U2 — GitHub CLI unavailable:** `gh` is not installed; visibility was confirmed via the
  unauthenticated GitHub REST API and `git ls-remote` instead. PR/branch protection state on
  GitHub was not queried.
- **U3 — Public-source snapshot drift (Gate A bundle):** The original public-source snapshot
  used to build the Gate A bundle is **not present locally**, so an exact file-level diff
  against it could not be produced. What is established: production = `origin/main` =
  `910ab2c`; the local start branch (`fix/phase0-neutralize-client-textbelt`) is 5 commits
  ahead and diverges (adds `communications.html` + Phase 1/2 server/Comms code + docs;
  removes only `crm.html`'s key). Treat the design-intent review as **not yet reconciled**
  to production until the actual snapshot is supplied.
- **U4 — `social.html` / `cancel-reschedule.html` live fetch:** Only `crm/rosalia/mechanical`
  were fetched live; the other two were verified from `main` source only (both carry
  `service_role`).

---

## Full classification table (pages, routes, functions reviewed)

| Item | Type | Deployed on `main`? | Auth | Credential exposure | Classification |
|---|---|---|---|---|---|
| `crm.html` | Admin page | Yes | none | **service_role JWT (browser)** — live | 🔴 Critical creds-in-browser (admin) |
| `rosalia.html` | Admin page | Yes | none | **service_role JWT (browser)** — live | 🔴 Critical creds-in-browser (admin) |
| `mechanical.html` | Admin page | Yes | none | **service_role JWT (browser)** — live | 🔴 Critical creds-in-browser (admin) |
| `social.html` | Admin page | Yes | none | **service_role JWT (browser)** | 🔴 Critical creds-in-browser (admin) |
| `cancel-reschedule.html` | Customer page | Yes | none | **service_role JWT (browser)** | 🔴 Critical creds-in-browser (customer-facing) |
| `communications.html` | Admin page (SMS inbox) | **No (branch-only)** | server wrapper | none embedded | 🟡 5th admin page; not in prod |
| `/book-demo` → `book-demo.html` | Marketing route | Yes | n/a static | none | 🟢 Public static |
| `/book/florostone` → `book-demo.html?client=` | Marketing route | Yes | n/a static | none | 🟢 Public static |
| `/florostone` → `florostone.html` | Marketing route | Yes | n/a static | none | 🟢 Public static |
| `/listings/:slug` → `listings/:slug.html` | Marketing route | Yes | n/a static | none | 🟢 Public static (static-file rewrite, not dynamic) |
| `/tour/:slug` → `tour/:slug.html` | Marketing route | Yes | n/a static | none | 🟢 Public static (static-file rewrite, not dynamic) |
| `lookup` | HTTP function | Yes | **none** (CORS `*`) | uses `SUPABASE_SERVICE_KEY` (env) | 🔴 Unauthenticated Vapi/DB endpoint |
| `sendcallrecap` | HTTP function | Yes | **none** | Vapi/Textbelt via env | 🔴 Unauthenticated endpoint |
| `respondrosalia` | HTTP function | Yes | **none** | Anthropic/Supabase/Gmail/Textbelt env | 🔴 Unauthenticated endpoint (sends) |
| `sendemail` | HTTP function | Yes | **none** | Gmail (nodemailer) + Supabase env | 🔴 Unauthenticated send endpoint |
| `hvac-outreach` | HTTP function | Yes | **none** | Vapi/Supabase/Textbelt/Anthropic env | 🔴 Unauth, misdocumented as scheduled; triggers calls/SMS/email |
| `inventory` | HTTP function | Yes | (n/a here) | **hardcoded Google SA private key** | 🔴 Hardcoded secret in public source |
| `readmail`/`fubsync`/`autocall`/`healthcheck`/`sendsurvey`/`followup`/`appointment-reminder`/`appointment-reminder-evening` | Scheduled functions | Yes | schedule-triggered | env | 🟢 Scheduled per `netlify.toml` (§V9) |
| `netlify/functions/*` (legacy dup) | Legacy tree | Not the deployed dir | n/a | **hardcoded Supabase JWTs** | 🟠 Not deployed but public in repo |
| `backups/*`, `ABREVO-FINAL-BACKUP-*` | Backup trees | n/a | n/a | **hardcoded Supabase JWTs** | 🟠 Public secret history |

---

## Required-search results (no secret values printed)

| Search term | Result (deployed/browser scope) |
|---|---|
| `eyJhbGciOiJIUzI1NiI` (JWT) | Present in 5 browser HTML on `main` (4 on Phase 0 branch); legacy `netlify/functions/*` + backups |
| `service_role` (decoded role) | All 5 browser JWTs decode to `role":"service_role"` |
| `BEGIN PRIVATE KEY` | `functions/inventory.js` (hardcoded Google SA key) |
| `textbelt` / `TEXTBELT` | Many server functions (env `TEXTBELT_KEY`); `rosalia.html` hits are Phase 2.6 *removal comments*, not live keys |
| `vapi` | `hvac-outreach.js` (VAPI_KEY), docs (`ROSALIA-SYSTEM-GUIDE.md` leaks key/phone id), README |
| `SUPABASE_SERVICE_ROLE` / `SUPABASE_SERVICE_KEY` | Deployed functions read `process.env.SUPABASE_SERVICE_KEY` |
| `X-Internal-Token` | **Not present anywhere** |
| Gmail creds | `sendemail.js` + `respondrosalia.js` (nodemailer Gmail, `GMAIL_PASS_INQUIRIES` env) |
| Google service-account fields | `functions/inventory.js` (`private_key`, `client_email`, `private_key_id`) |
| Netlify schedule declarations | 8 in `netlify.toml` (§V9); `hvac-outreach` absent |
| every `lookup` reference | No in-repo caller (external only) — §V5 |
| every `hvac-outreach` reference | No in-repo caller/schedule — §V7 |

---

## Bottom line for Sessions 2 & 3

The dominant, production-live risk is **five browser-delivered files embedding a Supabase
`service_role` key** on a **public** repo, plus **unauthenticated HTTP functions** with real
side effects and a **hardcoded Google service-account private key**. These are verified facts,
not design intent. Remediation, rotation, and Netlify/GitHub-side confirmation (U1–U4) remain.
