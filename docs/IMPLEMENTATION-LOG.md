# Rosalia / Abrevo — Gate A Security Remediation Implementation Log

Live audit trail of execution. Complements the Executive Brief (why), the
design/remediation plans (what), the Gate A bundle (how), and the Acceptance
Criteria (when it's done).

---

## Session 5 (integration owner) — execution record

- **Integration branch:** `security/gate-a-integration`
- **Repository:** `github.com/RosaliaGroup/Abrevo` (confirmed `origin`)
- **Base branch / HEAD:** `main` @ `910ab2c` (production deploy source)
- **Worktree:** `C:/Users/ana/Abrevo-gate-a` (isolated; not `main`, not the phase0/SMS worktrees)
- **Netlify deploy source (confirmed, read-only):** site `silver-ganache-1ee2ca`,
  custom domain `abrevo.co`, connected repo `RosaliaGroup/Abrevo`, production branch `main`,
  no build command (static root + `functions/`, esbuild bundler). Matches this checkout.
- **Design intent applied from:** `gate-a-v3` bundle + Executive Brief + Phase 9 Audit +
  Credential Remediation Plan + Admin Security Design + Gate A Acceptance Criteria.
  The bundle is **design intent**, not committed Session 1–4 branches (none existed);
  patches were regenerated/verified against the live `main` files.

### Milestone tracker

| Item | Status | Notes |
|---|---|---|
| Deploy source confirmed | ☑ | silver-ganache-1ee2ca → RosaliaGroup/Abrevo @ main; matches checkout |
| Fifth-file secret scan | ☑ | Admin surface = rosalia/crm/social/mechanical.html. **Fifth file found:** `cancel-reschedule.html` embeds a (dead) service_role JWT — public page, NOT edge-gated → deferred to Gate C/D. |
| `lookup` caller traced + classified | ☑ (deferred) | Left UNCHANGED per design (no confirmed caller). Change does not affect it. |
| Marketing routes classified | ☑ | `/book-demo`, `/florostone`, `/listings/:slug`, `/tour/:slug` → grep-clean (no `eyJ`) → **PUBLIC**, no gating. |
| Gate A applied locally | ☑ | Branch `security/gate-a-integration`; patches regenerated from live files (byte-identical to main snapshot for functions; toml/rosalia.html regenerated). |
| Local verification | ☑ | See below. |
| Preview deployed | ☐ | **BLOCKED on approval** — requires env vars on prod Netlify site + a deploy. Not done unilaterally. |
| Preview validation passed | ☐ | Pending preview. `validate-gate-a.sh` requires a live PREVIEW_URL. |
| Acceptance criteria all met | ⧗ | Security invariants verified in code + unit tests; live-preview items pending. |
| Rollback plan documented | ☑ | Don't merge branch; delete branch; Netlify "Publish deploy" to prior good; `env:unset`. |
| Production deployed | ☐ | **NO** — not authorized; blockers outstanding (Vapi manual config). |

### Files changed (vs `910ab2c`)

New:
- `netlify/edge-functions/admin-gate.ts` — edge Basic-auth gate, default-deny, timing-safe.
- `functions/_gate-a-auth.js` — `requireGateA` + `adminCorsHeaders` (default-deny, OPTIONS-stop, non-wildcard CORS).
- `functions/_internal-auth.js` — `requireInternalToken` + `NO_CORS` (server-to-server, default-deny).
- `functions/_healthcheck-worker.js` — extracted probe/write logic + `dryRun`.
- `functions/admin-healthcheck-run.js` — gated manual healthcheck, dry-run default.
- `validate-gate-a.sh` — preview validation suite (refuses production by default).

Modified:
- `functions/healthcheck.js` — now a thin **scheduled wrapper** over the worker (no HTTP params, no auth guard — scheduler-only).
- `functions/inventory.js`, `functions/ai-enrich.js` — `requireGateA` + non-wildcard CORS; auth before body/provider.
- `functions/respondrosalia.js`, `hvac-outreach.js`, `sendemail.js`, `sendcallrecap.js` — `requireInternalToken`; **auth before method check / body / logic**; `NO_CORS`.
- `netlify.toml` — 8 `[[edge_functions]]` matchers for admin-gate (rosalia/crm/social/mechanical, each `.html` + bare). No `/*` or `/.netlify/functions/*` matcher (scheduled fns untouched).
- `rosalia.html` — health-check button repointed to `admin-healthcheck-run` (dry-run); graceful non-2xx handling; readmail/autocall render `N/A` when execution unknown.

Renamed (off deploy surface):
- `functions/sms-campaign-hvac.js` → `scripts/sms-campaign-hvac.js` (CLI, never a handler).
- `functions/bulkemail.js` → `scripts/bulkemail.js` (mass-blaster, no caller).

Untouched (intentional): `lookup.js`; all scheduled fns (`readmail`, `autocall`, `fubsync`,
`sendsurvey`, `followup`, `appointment-reminder[-evening]`); all public booking fns
(`book`, `get-availability`, `reschedule`, `cancel`) and pages.

### Conflicts & resolutions

1. **Response-shape conflict (healthcheck).** The dashboard reads `data.book_ok` etc. at
   top level (old scheduled healthcheck returned `{status, ...record}` flat). The bundle's
   `admin-healthcheck-run` returned `{...result, effectiveDryRun}` with probe fields **nested**
   under `data.record`. → Resolved by flattening `record` back to top level in
   `admin-healthcheck-run.js` (preserves the dashboard contract; `effectiveDryRun` stays top-level for the validator).

2. **Operational-invocation hazard (healthcheck worker).** The bundle worker probes
   `readmail`/`autocall` by POSTing `{}` **before** the `dryRun` check. Those are OPERATIONAL
   scheduled fns (readmail reads live Gmail + sends AI replies; autocall places Vapi calls +
   SMS). A dry/manual/validation run would invoke them with prod credentials. → Resolved:
   in `dryRun` the worker **skips** those probes and reports `readmail_execution`/`autocall_execution`
   = `"unknown"` (never invoked, never reported "healthy"). Scheduled (cron) path unchanged;
   written `system_health` schema unchanged (unknown fields are return-only). Implements the
   Acceptance-Criteria `readmail_execution:"unknown"` semantics that the v3 bundle had omitted.

3. **Auth-ordering (internal endpoints).** Bundle diff put the `405` method check before the
   token gate. → Reordered so `requireInternalToken` runs **before** method check / body parse /
   logic (Acceptance-Criteria "auth-first ordering"; invariant #3).

4. **netlify.toml / rosalia.html anchor drift.** The public-source diffs assumed a specific
   surrounding context; the live files differ. → Regenerated the edits against the live files
   (edge block inserted before `[functions]`; healthcheck button located by its actual fetch call).

### Local verification results

- `git diff --check`: clean.
- `node --check` on all 13 new/changed JS files: PASS.
- Guard unit tests (`_gate-a-auth`, `_internal-auth`, built-in `crypto` only): **14/14 PASS**
  (default-deny w/o config; OPTIONS→204 stop; missing/invalid creds→401/403; correct creds→ok;
  rejects non-Basic bearer incl. JWT-shaped; no dev-bypass on preview context; non-wildcard CORS;
  internal-token default-deny/valid).
- Healthcheck dry-run safety tests: **7/7 PASS** (dryRun does NOT invoke readmail/autocall;
  reports `execution:"unknown"`; `readmail_ok` null; no Supabase write).
- Secret scan (added lines): **no new secret literals** introduced by Gate A changes.
- Unit/integration test suite & build command: **N/A for this repo** (empty `package.json`
  scripts; static root + functions bundled by Netlify; no local build). Edge-fn TS type-check
  deferred to Netlify's Deno bundler (no local `deno`).

### Manual code verification (11 invariants)

1. Admin dashboards edge-gated — ☑ (8 matchers + default-deny `admin-gate.ts`).
2. Confirmed admin fns protected in code — ☑ (`inventory`, `ai-enrich`, `admin-healthcheck-run` self-gate).
3. Internal endpoints authenticate before method/body/logic — ☑ (reordered; verified gate precedes 405).
4. Public booking/cancel/reschedule remain public — ☑ (files untouched; not in matcher).
5. Genuine scheduled wrappers not admin-gated — ☑ (`healthcheck.js` wrapper unguarded; schedule intact).
6. Healthcheck cannot invoke operational fns (manual/dry path) — ☑ (dryRun skips readmail/autocall).
7. Unknown scheduler execution never reported healthy — ☑ (execution `"unknown"`, dashboard `N/A`).
8. Inventory credentials environment-based — ☐ **NOT met by Gate A** — `inventory.js` still hardcodes a Google service-account private key (server file). Gate A only gates access; move-to-env + rotate is **Gate C/D**. Documented finding.
9. Browser assets contain no privileged credentials — ⧗ **partially** — after edge-gating, the 4 admin dashboards return 401 to anon (no leak). Keys remain embedded (delivered only post-auth). `cancel-reschedule.html` (public, un-gated) still leaks a dead JWT. Full strip = Gate C.
10. Bulk-send scripts not deployed as fns + dry-run default — ⧗ moved off deploy surface (☑); `bulkemail.js` has **no** dry-run mode (residual — recommend adding before any manual use).
11. Vapi-facing endpoints have a valid caller-auth plan — ⧗ **plan yes, config no** — `requireInternalToken` guards them, but a real Vapi caller must send `X-Internal-Token`, which is **manual Vapi-dashboard config not yet done**. → These 4 endpoints are **BLOCKED from production** until Vapi is configured (or confirmed to have no live caller). Safe on preview.

### Running notes

- `2026-07-20` — Deploy source confirmed; integration worktree created off `910ab2c`.
- `2026-07-20` — Bundle applied + 4 conflicts resolved; local verification passed.
- `2026-07-20` — Preview deploy deferred pending explicit approval (requires env vars on the
  production Netlify site + a deploy; repo shared with concurrent sessions).

### Rollback

- Preview stage: do not merge; `git branch -D security/gate-a-integration`;
  `git worktree remove C:/Users/ana/Abrevo-gate-a`.
- If ever deployed: Netlify → Deploys → previous good deploy → **Publish deploy**.
- Remove gate env: `netlify env:unset ADMIN_GATE_USER ADMIN_GATE_PASS INTERNAL_TOKEN`
  (per applicable context). Env changes require a new deploy to take effect.

### Guardrails

- Sequence Gate 0 → A → B → C → D. Do NOT rotate the Supabase key before Gate C removes the
  dashboards' dependency on it.
- No live sends during validation; manual healthcheck stays dry-run.
- Done = acceptance criteria met on a preview, not "bundle applied."
