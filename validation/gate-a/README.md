# Gate A — Validation Framework (Session 4)

Static + preview validation for the Gate A containment work on the Abrevo repo.
**Read-only and side-effect-free by construction.** No deploys, no sends, no DB
writes, no scheduled-function invocation, no valid internal tokens.

This framework was reconciled against the **live local repository** at
`f248fc0` (branch `fix/phase0-neutralize-client-textbelt`), **not** the
public-source `gate-a-v3` bundle. Where the bundle and the repo disagree, the
repo wins (see [Reconciliation](#reconciliation)).

## Layout
```
validation/gate-a/
├── static-checks.sh              # 12 local/static checks (offline)
├── scan-secrets.sh               # redacting secret scanner (browser|code modes)
├── validate-gate-a.sh            # preview-deploy validation (read-only HTTP)
├── deferrals.allowlist           # documented/accepted secret deferrals (empty by default)
├── VALIDATION-RESULTS-TEMPLATE.md
├── lib/
│   ├── common.sh                 # helpers, result accounting, shared detector regexes
│   └── check-unknown-mapping.js  # object-scoped 'unknown'->healthy honesty check
└── fixtures/
    ├── selftest.sh               # proves the validators CATCH defects (24 assertions)
    ├── mock-preview-server.js    # loopback good/bad preview (no real infra)
    └── static/                   # negative fixtures (fake secrets, wildcard CORS, …)
```

## Usage

### 1. Static (offline — run anytime)
```bash
bash validation/gate-a/static-checks.sh
```
Exit 0 = pass. `[FAIL]` = a wrong/dangerous state that exists now. `[DEP]` = a
Gate A target not yet implemented by Sessions 1–3 (surfaced, non-fatal).

### 2. Self-test (offline — proves the validators work)
```bash
bash validation/gate-a/fixtures/selftest.sh   # expect 24/24, RESULT: PASS
```

### 3. Preview (against a real Netlify preview deploy — never production)
```bash
PREVIEW_URL=https://deploy-preview-42--abrevo.netlify.app \
  ADMIN_USER=... ADMIN_PASS=... \
  bash validation/gate-a/validate-gate-a.sh
```
`ADMIN_USER/PASS` are optional; without them the authenticated healthcheck
semantics become `[DEP]`. **Never** pass a real `X-Internal-Token` — the suite
only ever sends an *invalid* token to prove rejection.

## Result vocabulary
| Tag | Meaning | Fails the run? |
|---|---|---|
| `PASS` | Gate A property met now | — |
| `FAIL` | A wrong/dangerous state exists now | **yes** |
| `DEP`  | Target not yet implemented by Sessions 1–3 | no |
| `WARN` | Documented/deferred finding, anon key, or review signal | no |

## Secret scanning — accuracy notes
- **JWTs are decoded.** A Supabase **service_role** key in a browser asset is a
  hard `FAIL`; a Supabase **anon** key is public-by-design and is downgraded to a
  `WARN`. We do not cry wolf on anon keys.
- **Code vs browser modes.** In `code` mode, `x = process.env.X` and bare
  variable references are the *safe* pattern and are ignored; only a **hardcoded
  literal** assigned directly to a sensitive identifier is a finding. In
  `browser` mode, any reference to a privileged system is surfaced (a browser
  asset should not name them at all).
- **Test fixtures.** Weak-shape findings inside `__tests__`/`*.test.js`/`fixtures/`
  are downgraded to `WARN` (dummy creds). Real secret shapes (PEM / service-role
  JWT / app-password) still fail everywhere.
- **Redaction.** No full secret value is ever printed — at most the first 4
  chars plus a length marker.
- **Deferrals.** `deferrals.allowlist` lets an owner mark a known finding as
  intentionally deferred (e.g. server-side keys → Gate D rotation), satisfying
  the AC "clean OR every finding documented" clause. It is **empty by default**
  on purpose.

## Production-target safeguards (in `validate-gate-a.sh`)
1. `PREVIEW_URL` required; must be an absolute http(s) URL.
2. Known production hosts (`app.abrevo.co`, `abrevo.co`, `rosaliagroup.com`,
   `mechanicalenterprise.com`, `book.*`) are **refused** unless
   `GATEA_ALLOW_PROD_OVERRIDE=I_UNDERSTAND` is set in the shell (never committed).
3. Even under override, **all POST probes are hard-disabled** off-preview, so no
   mutating/send-capable request can reach production. Only read-only GETs run.
4. No valid send tokens — only an invalid token is ever transmitted.
5. No booking payloads — public functions are proven reachable via a
   non-mutating GET probe (405/400/200 all confirm reachability without creating
   a record).
6. Non-preview/non-localhost hosts trigger a `WARN` prompting manual confirmation.

---

## Reconciliation

Verified against the live repo (`functions/`, root `*.html`, `netlify.toml`).
The reconciled inventory used by both scripts:

| Group | Members (confirmed present locally) |
|---|---|
| Admin dashboards | `rosalia.html` `crm.html` `social.html` `mechanical.html` |
| Privileged fns (gate_now) | `inventory` `ai-enrich` **`admin-healthcheck-run`**† |
| Internal-token fns | `respondrosalia` `hvac-outreach` `sendemail` `sendcallrecap` |
| Removed-from-deploy | `sms-campaign-hvac` `bulkemail` (still in `functions/` today) |
| Scheduled | `readmail` `autocall` `fubsync` `healthcheck` `sendsurvey` `followup` `appointment-reminder` `appointment-reminder-evening` |
| Public pages | `index.html` `booking-rosalia.html` `booking-form.html` `reschedule-rosalia.html` `cancel-reschedule.html` |
| Public fns | `book` `get-availability` `reschedule` `cancel` |

### Where the public `gate-a-v3` bundle is stale vs. the live repo
1. **`admin-healthcheck-run` does not exist yet** — only `healthcheck.js` is
   present. The bundle's `validate-gate-a.sh` assumes it is deployed. → `DEP`
   (Session 3).
2. **Bare aliases `/rosalia` `/social` `/mechanical` are not routed.** Only
   `/crm` has a `status=200` redirect to `crm.html`; the rest fall through to the
   SPA `/*` → `index.html`. Edge matchers for admin-gate are not registered yet.
   → tested as conditional (`DEP`, Session 2).
3. **`sms-campaign-hvac.js` and `bulkemail.js` are still in `functions/`** (not
   yet `git mv`'d to `scripts/`). The bundle assumes they 404. → `DEP`.
4. **Gate helper files not landed**: `_gate-a-auth.js`, `_internal-auth.js`,
   `_healthcheck-worker.js`, and `netlify/edge-functions/admin-gate.*` do not
   exist yet. → `DEP` (Sessions 2/3).
5. **The bundle's own `_healthcheck-worker.js` violates Gate A intent** — it
   fetches operational function URLs (`https://abrevo.co/.netlify/functions/...`,
   `textbelt.com`, `api.vapi.ai`). Treat the bundle as design intent only;
   Session 3's real worker must not probe operational URLs. Check [7] enforces
   this on the landed implementation.

### Acceptance-criteria route references
`GATE-A-ACCEPTANCE-CRITERIA.md` route names were verified against the repo and
found **accurate** — no corrections were necessary. (One clarification worth
noting for reviewers: `cancel-reschedule.html` is a *public* customer page, yet
it currently embeds a service-role JWT — so the "browser-delivered asset" secret
scan must cover public pages, not just the four admin dashboards. This framework
scans all HTML.)

### Real findings surfaced against the current repo (for Sessions 2/3/Gate D)
The scanners flag these live, high-confidence issues (all redacted in output):
- **Service-role Supabase JWT** embedded in `rosalia.html`, `social.html`,
  `mechanical.html`, and public `cancel-reschedule.html` (`crm.html` already
  cleaned). → Gate A blocker until removed.
- **Vapi key literal** embedded in the three admin dashboards.
- **Google service-account private key** hardcoded in `functions/inventory.js`.
- **Gmail app passwords** hardcoded in `functions/book-appointment.js` and
  `functions/readmail.js`.

Server-side embedded secrets (inventory/book-appointment/readmail) are Gate D
(rotation) scope; browser-delivered service-role keys are the Gate A target.

## Dependencies on Sessions 1–3
- **Session 1** — local verification report / public-vs-public route
  classification (e.g. `/book-demo`, `/florostone`, `/listings/:slug`,
  `/tour/:slug`, and the `lookup` caller trace). Not yet present; framework runs
  without it.
- **Session 2** — auth/routing: `admin-gate` edge function, `netlify.toml` edge
  matchers, `requireGateA`/`requireInternalToken` on the privileged/internal
  functions, moving `sms-campaign-hvac`/`bulkemail` to `scripts/`. Checks
  [2][6][8][9][10][11][12] + P1/P2/P3/P4 flip from `DEP` to `PASS`/`FAIL` once
  landed.
- **Session 3** — healthcheck/inventory: `admin-healthcheck-run` +
  `_healthcheck-worker.js` (dry-run default, sanitized output, `unknown`
  semantics, no operational URLs). Checks [7] + P6 depend on it.
