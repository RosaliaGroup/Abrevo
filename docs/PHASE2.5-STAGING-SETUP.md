# Phase 2.5 — Environment Boundaries, Staging Setup & Readiness

**Date:** 2026-07-20 · **Status:** No isolated environment could be created safely here (no cloud CLIs/credentials, no local Postgres/Docker). Nothing applied, deployed, rotated, or sent. This document is the exact setup the owner must perform.

## 1. Environment map (no secret values shown)

| | Value |
|---|---|
| **Production Supabase** | project `fhkgpepkwibxbxsepetd` (the only project referenced anywhere in code) |
| **Separate dev/staging Supabase** | **None found** — no second project ref exists in the repo |
| **Production Netlify** | Abrevo site; production domain `app.abrevo.co` (per `netlify.toml [context.production.environment]`); operator-stated URL `silver-ganache-1ee2ca.netlify.app` |
| **Preview / branch-deploy env scoping** | `netlify.toml` has **only** `[context.production.environment]` (sets `DOMAIN`). There are **no** `[context.deploy-preview.environment]` or `[context.branch-deploy.environment]` blocks → previews/branch deploys **inherit the same env vars as production** by default |
| **Does any preview point at prod Supabase?** | **Yes, effectively.** (a) Env vars are shared across contexts (no preview override), so `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` in a preview = production. (b) Legacy files (`crm.html`, `respondrosalia.js`, `book.js`, …) **hardcode** the production Supabase URL/keys, so any preview serving them hits prod regardless of env vars |
| **Would Communications code touch prod data in a preview?** | **Yes** — `commContext` reads `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` from env, which currently resolve to production in every context |

**Conclusion:** a Netlify preview is **not safe** today. It would read/write production Supabase. No preview was deployed.

## 2. Isolated Supabase environment — NOT created

No clearly-authorized ownership/billing/naming exists for creating a new Supabase project, and no CLI/credentials are available in this environment. **Not created. No migration applied anywhere.**

### Exact manual setup steps for the owner
1. **Create a dedicated staging Supabase project** (e.g. name `abrevo-staging`), separate org/project from `fhkgpepkwibxbxsepetd`. Confirm billing impact is acceptable.
2. In the SQL editor of the **staging** project, run the migrations **in order**:
   - `supabase/migrations/20260720120000_communications_conversations.sql`
   - `supabase/migrations/20260720120001_communications_messages.sql`
   - `supabase/migrations/20260720120002_communications_conversation_links.sql`
   - `supabase/migrations/20260720130000_communications_phase2.sql`  *(now includes the `conversations_last_message_at_idx` index)*
3. **Seed synthetic records only** (fake phones like `+1555…`); never import production rows.
4. In Netlify, create **context-scoped** env vars so previews use staging, e.g.:
   ```toml
   [context.deploy-preview.environment]
     SUPABASE_URL = "https://<staging-ref>.supabase.co"
     # SUPABASE_SERVICE_KEY set as a deploy-preview-scoped secret in the Netlify UI
     TELNYX_FROM_NUMBER = "+1XXXXXXXXXX"   # staging/no-send
   ```

### Values the owner must provide
- Staging `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (service-role, staging only).
- Staging `TELNYX_API_KEY` + `TELNYX_FROM_NUMBER` (or a no-send/mock mode flag).
- `TELNYX_PUBLIC_KEY` for staging webhook verification.
- Authorization to create the project and set preview-scoped secrets.

## 3. Migration validation status
A **live** validation could not be run: no Postgres/Docker/`psql`/`supabase` CLI is available locally, and there is no isolated cloud env. Applying to production is prohibited.

What IS validated now (behavioral, via 70 unit tests against a fake that mirrors the DB constraints) vs. what remains **pending a real DB**:

| §3 check | Status |
|---|---|
| Tables/constraints/indexes/FKs created | Pending live apply (DDL statically reviewed; idempotent) |
| RLS enabled where designed | Pending live apply (migration 4 enables RLS + revokes anon/authenticated) |
| Browser/anon cannot write via service-role path | Pending live apply (design: anon denied by RLS; server uses service key) |
| Service endpoints perform authorized ops | **Covered** by unit tests (API/webhook logic) — pending live over PostgREST |
| Duplicate normalized-phone blocked | **Covered** (unit) — pending unique-index confirmation on real DB |
| Duplicate entity linkage blocked | **Covered** (unit) — pending unique-index confirmation |
| Duplicate inbound/provider events blocked | **Covered** (unit) — pending unique-index confirmation |
| Conversation/message pagination | **Covered** (unit) |
| Opt-out enforcement | **Covered** (unit) |
| `last_message_at` index exists | **Added** to `20260720130000_…` (unapplied) |

## 4. Preview deployment
**Not created.** A safe preview cannot be guaranteed (see §1). No deploy performed.

## 5. Credential & compliance readiness (report only — nothing modified)

### Textbelt
- **Env var names in active code (deployed `origin/main`):** `TEXTBELT_KEY`, `TEXTBELT_KEY_2`. (Commit `ed89fc4` moved active `functions/*` to env vars — they are **not** hardcoded on the deployed main; corrects the earlier stale-checkout impression.)
- **Two distinct key VALUES remain exposed** (`0672a5cd…` and `06aa74dc…`) in:
  - `rosalia.html` — **browser** (quota panel `monLoadSmsCredits`; the send-path key was neutralized in Phase 0).
  - Dead/backup/doc: `netlify/functions/*`, `backups/*`, `ABREVO-FINAL-BACKUP-MAR9-2026/*`, `ROSALIA-SYSTEM-GUIDE.md`.
  - **Git history** (e.g. commits `50caab5`, pre-`ed89fc4`) — present regardless of current files.

### Supabase service-role
- `crm.html` (line ~415) hardcodes the **`service_role`** JWT in **browser** code (present on `origin/main`; added in history at `3dc6c2b`). Also present in Git history.

### Are exposed values still in Git history?
**Yes — all of them.** Removing from current files does not remove them from history; rotation is mandatory.

### Recommended rotation sequence
1. **Supabase `service_role` first** (highest blast radius — full DB, bypasses RLS): rotate the key in Supabase → update `SUPABASE_SERVICE_KEY` in Netlify → move `crm.html` reads behind a server function (so no key ships to the browser).
2. **Textbelt key `TEXTBELT_KEY` / `TEXTBELT_KEY_2`**: rotate both in the Textbelt dashboard → update Netlify env → remove the `rosalia.html` quota-panel literals (move quota server-side).
3. Optionally scrub history (BFG/filter-repo) — but rotation is the real remediation; history scrub is secondary.

### Telnyx 10DLC verification
**Cannot verify from here** — no Telnyx CLI, API key, or dashboard access in this environment. The owner must report, from the Telnyx portal → Messaging → 10DLC / Campaigns:
- Brand registration status (e.g. VERIFIED).
- Campaign status (e.g. APPROVED / PENDING / REJECTED) and campaign ID.
- The messaging profile + sending number(s) attached to the approved campaign.
No Telnyx account change was made.

## 6. Phase 3 pilot recommendation — `sendForm.js` (do NOT migrate yet)
| Aspect | Detail |
|---|---|
| **Current trigger** | HTTP `POST` to the `sendForm` function with `{ phone, name, property, type }` — an on-demand call (agent/dashboard/booking flow), not scheduled |
| **Current recipients** | A **single** recipient — the one `phone` in the request body |
| **Message purpose** | Sends a booking/qualification **form link** (Rosalia or Mechanical, book/reschedule variant) — informational, non-critical |
| **User-initiated or automated** | **User/agent-initiated**, on demand (best-fit for a first pilot) |
| **CRM linkage available** | Phone (+ name/property) → link by phone via find-or-create; optionally match an existing `lead` by phone. No lead/booking id is passed today |
| **Expected conversation behavior** | find-or-create conversation by normalized phone → send one outbound → thread shows one outbound message with delivery status; reuse the thread on repeat sends |
| **Rollback boundary** | Single function file; revert `sendForm.js` to the Textbelt path. No shared state; no schema dependency beyond the (staging) Communications tables |
| **Manual QA procedure** | On staging: POST a synthetic `{phone:'+1555…', name, property}` → assert (1) one conversation created (or reused), (2) one outbound message persisted `queued→sent` via mock/staging Telnyx, (3) thread renders it, (4) repeat POST reuses the same conversation (no duplicate), (5) opted-out phone is blocked. No live SMS |

**Why it's the lowest risk:** single-recipient, user-initiated, non-critical informational link — explicitly **not** an emergency, compliance, bulk-campaign, AI-decision, or critical-notification workflow (those are excluded). Simple payload, trivial rollback, easy synthetic QA.
