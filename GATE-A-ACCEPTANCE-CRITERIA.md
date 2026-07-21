# Gate A — Acceptance Criteria (objective "done" checklist)

Objective pass/fail gate before any production deployment. Annotated by Session 5
(integration owner) with verification status against branch `security/gate-a-integration`
(base `main` @ `910ab2c`). Criteria are **not weakened**; items only marked met / pending
(needs live preview) / deferred (out of Gate A scope, with reason).

Legend: ☑ met (verified) · ⧗ pending live preview · ⛔ deferred/out-of-scope · ❗ not met by Gate A

---

## Security
- ⧗ All four admin dashboards (`rosalia.html`, `crm.html`, `social.html`, `mechanical.html`) require authentication before any HTML is delivered. — *8 edge matchers + default-deny `admin-gate.ts` verified in code; needs live 401 confirmation on preview.*
- ⧗ Privileged Netlify functions (`inventory`, `ai-enrich`, `admin-healthcheck-run`) are no longer anonymously callable (401/403). — *`requireGateA` self-gate verified in code + unit tests; live confirmation pending.*
- ⧗ Internal-token endpoints (`respondrosalia`, `hvac-outreach`, `sendemail`, `sendcallrecap`) reject requests lacking a valid `X-Internal-Token` (401), not reachable with browser creds. — *`requireInternalToken` (auth-first) verified in code + unit tests; live confirmation pending. See Vapi blocker below.*
- ⧗ Scheduled functions (`readmail`, `autocall`, `fubsync`, `healthcheck`, `sendsurvey`, `followup`, `appointment-reminder[-evening]`) continue to execute on schedule with no auth regression. — *All unchanged; `healthcheck` wrapper stays scheduler-only (no guard); netlify.toml schedules intact. Cron execution only verifiable post-production.*
- ⧗ / ❗ No service-role key, Vapi key, Textbelt key, or other privileged credential remains in any **browser-delivered** asset. — *After edge-gating, anon fetch of the 4 dashboards → 401 (no leak). BUT keys remain **embedded** (served post-auth) and `cancel-reschedule.html` (public, un-gated) still contains a dead service_role JWT. Full removal = **Gate C**. Live scan pending.*
- ⧗ `sms-campaign-hvac` and `bulkemail` no longer deployed as callable functions (moved to `scripts/`; 404 at old URLs). — *Moved via `git mv`; 404 confirmation pending live. NOTE: `bulkemail` has no dry-run mode (residual).*

## Functionality
- ⧗ Public booking / customer pages work unchanged (`booking-rosalia.html`, `booking-form.html`, `reschedule-rosalia.html`, `cancel-reschedule.html`, `index.html`). — *Untouched; not in edge matcher; live 200 confirmation pending.*
- ⧗ Public booking functions still reachable (`book`, `get-availability`, `reschedule`, `cancel`). — *Untouched; live confirmation pending.*
- ⧗ Admin workflows function after authentication (inventory loads, AI enrich runs, healthcheck via authenticated manual endpoint). — *Needs preview + gate credentials.*
- ☑ Dashboard health-check button handles 401/403, non-JSON, non-2xx gracefully. — *Added explicit `if (!r.ok) throw` before JSON parse; existing try/catch renders an auth/error message and re-enables the button.*
- ☑ No unintended emails/SMS/calls/campaigns triggered during validation. — *Manual healthcheck defaults dry-run; dryRun now **skips** operational `readmail`/`autocall` probes (7/7 tests). Validator sends nothing.*

## Operations
- ⧗ Preview/branch deployment passes full `validate-gate-a.sh` (exit 0): admin 401/403, send-endpoint rejection, sanitized-output, and scheduler-execution `unknown` semantics. — *Pending preview. NOTE: the v3 `validate-gate-a.sh` does **not** itself assert `readmail_execution:"unknown"`; that semantic is now implemented in the worker + shown in the dashboard, but the validator script does not test it (validator gap, documented — criterion not weakened).*
- ☑ Production rollback documented + understood (Netlify "Publish deploy" to prior good; `env:unset`). — *Documented in IMPLEMENTATION-LOG; live "publish previous" not exercised (no deploy yet).*
- ☑ Repo-wide secret scan clean OR every finding documented + intentionally deferred. — *Findings documented: 4 dashboards + `cancel-reschedule.html` (service_role JWT), `inventory.js` (Google private key), Vapi keys in rosalia/social/mechanical — all deferred to Gate C/D. No new secrets added by Gate A.*

## Post-Gate A (do NOT start before Gate A passes)
- ☑ Deploy source confirmed (site/repo/branch) — silver-ganache-1ee2ca → RosaliaGroup/Abrevo @ main.
- ⛔ `lookup` caller trace — left UNCHANGED (deferred); no confirmed caller; Gate A does not touch it.
- ☑ Four marketing/listing routes classified — grep-clean → **PUBLIC**, not gated.
- ☑ Fifth-file check — admin surface = the 4 dashboards; `cancel-reschedule.html` flagged as an additional public file with a dead key (Gate C).
- ⛔ Gate B (Supabase Auth) → Gate C (strip embedded keys) → Gate D (rotation) — sequenced after Gate A passes.

---

## Implementation stance
Treated as a fresh engineering exercise against the live repository. Large-function diffs were
verified byte-identical to the `main` snapshot (applied cleanly); `netlify.toml` and `rosalia.html`
edits and the healthcheck worker were **regenerated from the live files** to preserve intent
(auth-first ordering, non-wildcard CORS, sanitized output, scheduler execution `unknown`, dry-run
defaults). Passing these criteria on a **preview** is what establishes production-readiness — not
"bundle applied."

*Sequencing: secure access (A) → real login (B) → strip embedded keys (C) → rotate credentials (D).*
