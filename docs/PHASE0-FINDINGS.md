# Phase 0 Findings — Rosalia Group SMS / Communications Migration

**Date:** 2026-07-19
**Author:** Automated Phase 0 investigation (read-only audit + one scoped security fix)
**Status:** Investigation complete. **Build-first recommended.** No Telnyx build started. Nothing merged or deployed.

> Purpose: record the Phase 0 audit so future sessions do not repeat it. The
> original brief assumed an existing internal Telnyx-backed Communications
> system that Abrevo could reuse. That assumption is **false for Abrevo**. See
> "Headline" below.

---

## Headline

- **Abrevo has no Telnyx backend and no Communications (conversation/inbox) module of its own.**
- A real Telnyx + conversation/inbox system **does exist on this machine**, but inside a **different application** (the Mechanical Enterprise HVAC CRM, repo `-hvac-campaigns-essex`), on **unmerged** feature branches, backed by a **different datastore** (Drizzle/Postgres) and **not deployed**. It is **not reusable** by Abrevo as-is.
- Therefore this is a **build-first** project for Abrevo, not a reuse-migration.
- The local Abrevo checkout was **~4 months stale** (last fetch 2026-03-23). The real deployed `origin/main` is **`910ab2c` (2026-06-17)**. All findings below are against `origin/main` after a read-only `git fetch`.

---

## 1. Repositories, directories, remotes, deployments investigated

Enumeration: all `.git` directories under `C:\Users\ana` (excluding `node_modules`).

| Local path | Remote | Branch / last commit | Application |
|---|---|---|---|
| `OneDrive/Desktop/Abrevo-Clean` | `github.com/RosaliaGroup/Abrevo` | local `feature/contact-to-supabase` (stale, based on Mar 23 `2e1db81`); **deployed `origin/main` = `910ab2c`, 2026-06-17** | **Abrevo** — Rosalia leasing/booking + Mechanical HVAC booking. Plain JS, Netlify functions + Supabase. **Task target.** |
| `OneDrive/Desktop/Abrevo2026` | `github.com/RosaliaGroup/abrevo-ai-calling` | `main` `d259b47` (2026-03-08) | Abrevo AI calling — separate, no SMS senders |
| `-hvac-campaigns-essex` (+ worktrees `hvac-customer-portal`, `hvac-seo-attribution`, and others) | `github.com/RosaliaGroup/-hvac-campaigns-essex` | `feature-project-management` and many feature branches | **Mechanical Enterprise HVAC CRM** — TypeScript, Drizzle/Postgres. **Owns the Telnyx + Communications system.** |
| `rosaliagroup-site` | `github.com/RosaliaGroup/rosaliagroup-site` | `fix/forms-single-endpoint` `2a30a6b` (2026-07-18) | Marketing site — **Telnyx legal/consent copy only** |
| `rosalia-platform` | *(no remote — local only)* | `phase-3-leasing-workflow` `3241937` (2026-07-12) | Rosalia real-estate platform (TS) — separate, no SMS senders |

**Deployment:** Abrevo deploys to Netlify from `origin/main` (`netlify.toml` builds from `functions/`; scheduled functions: `readmail`, `fubsync`, `autocall`, `healthcheck`, `sendsurvey`, `followup`). Supabase project `fhkgpepkwibxbxsepetd.supabase.co` (tables: `leads`, `bookings`, `tasks`).

---

## 2. The Telnyx / Communications system that WAS found

Location: **`-hvac-campaigns-essex`** (Mechanical Enterprise HVAC CRM), a TypeScript app. Real send + conversation infrastructure (not legal copy):

- `server/services/telnyxSms.ts` — POSTs `https://api.telnyx.com/v2/messages`
- `server/services/telnyxSignature.ts`, `telnyxDeliveryStatus.ts`, `smsWebhook.ts`, `smsReplyKeywords.ts`
- `server/services/appointmentSms.ts`, `scheduledSms.ts`
- `server/routers/smsCampaigns.ts`
- UI: `client/src/pages/SmsCampaigns.tsx`, `client/src/pages/EmailSMSCampaigns.tsx`
- Schema: `drizzle/0039_telnyx_webhook_events_and_inbox_links.sql` (inbound webhook events + inbox links)
- Env contract: `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER=+15516007027`, `TELNYX_PUBLIC_KEY`, `TELNYX_WEBHOOK_SIGNATURE_BYPASS`

## 3. Why it is NOT currently reusable by Abrevo

1. **Different application / business** — it belongs to Mechanical Enterprise HVAC CRM, not the Abrevo leasing/booking app.
2. **Unmerged and undeployed** — the Telnyx/Communications code exists only on local feature branches; nothing Telnyx is on any `origin` default branch (consistent with the operator's fact that the highest merged PR in the account is #12). There is no running production service to call.
3. **Different datastore** — it targets Drizzle/Postgres with its own schema; Abrevo uses Supabase (`leads`, `bookings`, `tasks`). No shared conversation storage.
4. **Different stack** — TypeScript/tRPC server vs Abrevo's plain-JS Netlify functions.

**Boundary rule:** Do **not** treat the HVAC CRM's undeployed Communications system as a shared production service for Abrevo.

## 4. Datastore and deployment boundaries

| | Abrevo | HVAC CRM (`-hvac-campaigns-essex`) |
|---|---|---|
| Stack | Plain JS, Netlify functions | TypeScript, tRPC server + React client |
| Datastore | Supabase (`leads`, `bookings`, `tasks`) | Drizzle/Postgres (own schema) |
| SMS provider (active) | **Textbelt** | **Telnyx** |
| Comms module | **none** | conversations/inbox/webhooks |
| Deployment | Netlify (from `origin/main`) | not deployed (feature branches) |

---

## 5. Active Textbelt senders (Abrevo `origin/main`)

**19 server functions** in `functions/` send (or check quota) via Textbelt, using env vars `TEXTBELT_KEY` / `TEXTBELT_KEY_2` and, in several files, **hardcoded** key literals:

`autocall.js`, `book.js`, `book-appointment.js`, `book-hvac.js`, `cancel.js`, `cincwebhook.js`, `followup.js`, `fubsync.js`, `healthcheck.js` (quota), `hvac-outreach.js`, `outbound.js`, `parsefubemail.js`, `readmail.js`, `reschedule.js`, `reschedule-hvac.js`, `respondrosalia.js`, `sendForm.js`, `sendsurvey.js`, `sms-campaign-hvac.js`.

Canonical phone normalization used across the codebase (e.g. `respondrosalia.js`): **digits only, prepend `+1` if 10 digits** (11 → `+`; else `+` + digits).

**Twilio:** no active code anywhere — historical references only. **Textbelt is the sole active SMS provider in Abrevo.**

## 6. Active `sms:` browser/OS entry points (Abrevo `origin/main`)

- `crm.html:511` — Lead Dashboard list: `<a href="sms:<phone>">Text</a>` (OS handler). Adjacent `<a href="tel:<phone>">Call</a>` is **voice — in scope to document, NOT to remove**.
- `crm.html:521` — Lead detail contact line: same `sms:` "Text" + `tel:` "Call".
- `rosalia.html:2318/2336` — client-side Textbelt send (`monSmsCancelLink`) — a client-side SMS bypass **and** a leaked credential. **NEUTRALIZED in this branch** (see §8).
- No `navigator.share()` SMS usage. `window.open` in `rosalia.html` is `_blank` navigation, not `sms:`.

## 7. Dead / backup / test / documentation-only references (classified, not defects)

- `netlify/functions/*` — **not built** (`netlify.toml` builds from `functions/` only). Its `reschedule.js` has a `createTransporter` typo and wrong phone `+2014970225` — **inert**.
- `backups/*`, `ABREVO-FINAL-BACKUP-MAR9-2026/` — backups.
- `mechanical 2026/hvac-export/*` (untracked) — an embedded copy of the HVAC CRM; the only place "telnyx" appears inside the Abrevo directory, but it is **not Abrevo code**.
- `functions/*.test.js` — tests.
- `rosaliagroup-site` `shared/legal/sms-consent.ts`, `PrivacyPolicy.tsx`, `TermsAndConditions.tsx`, `SmsConsent.tsx` — **legal/consent copy** mentioning Telnyx, not send code.
- Repo-junk empty files at root (`$null`, `findstr`, `git`, `type`, `where`, `{`, `main`, `powershell`) — noise, unrelated.
- `functions/readmail.js` `isGoogleVoiceLead` / `parseGoogleVoice` — **inbound** Google-Voice-as-email lead parsing, not an outbound texting path.

---

## 8. Security: exposed Textbelt keys requiring rotation

Two live Textbelt keys are hardcoded and public in the repo (and were browser-visible). **Both must be rotated in the Textbelt dashboard** — they are in git history, so source-side removal does not un-leak them. Rotation NOT performed here (requires explicit authorization + external account access).

| Key (truncated) | Env var name(s) | Locations |
|---|---|---|
| `<SET IN NETLIFY ENV>` (key A) | referred to as `TEXTBELT_KEY` (also hardcoded) | `functions/book.js`, `functions/reschedule.js` (hardcoded); `rosalia.html` (client — send + quota) |
| `<SET IN NETLIFY ENV>` (key B) | `TEXTBELT_KEY` fallback / `TEXTBELT_KEY_2` | `functions/book-hvac.js`, `cincwebhook.js`, `parsefubemail.js`, `respondrosalia.js`, `sendForm.js`, `reschedule-hvac.js` (hardcoded); `rosalia.html` (client — quota) |

**Scoped fix applied this branch:** `rosalia.html` client-side **send** action (`monSmsCancelLink`) neutralized — leaked key literal removed, direct send disabled, clear "SMS unavailable" message shown; the manual "Copy Cancel Link" fallback is preserved.

**Still exposed (out of scope for the send-only fix, flagged for rotation):** `rosalia.html` SMS-credits monitoring panel (`monLoadSmsCredits`, ~lines 2381–2382) still embeds both key literals in read-only quota checks. Rotation invalidates these; a follow-up should move quota checks server-side.

---

## 9. Recommendation: BUILD-FIRST

There is nothing production-ready for Abrevo to reuse. Recommended path: build a minimal server-side Telnyx Communications backend inside Abrevo (Netlify functions + Supabase), then migrate the 19 Textbelt senders and the `crm.html` `sms:` buttons onto it. Detailed sequenced plan lives in the session report / to be tracked separately.

## 10. Production blocker: Telnyx 10DLC

**Telnyx 10DLC campaign registration must be approved before any production sends.** The earlier Twilio A2P attempt was rejected on opt-in/privacy-page grounds, so this is a real risk, not a formality. No production sends until 10DLC is approved and a compliant opt-in/privacy surface exists.

---

## 11. Phase 0 browser QA (2026-07-20)

Method: served the worktree over local HTTP (`127.0.0.1`) and loaded `rosalia.html` in an isolated Chrome tab (no `file://`; the user's own tabs untouched). Exercised the neutralized System-Monitor "Send via SMS" action (`monSmsCancelLink`) with live network capture.

| Check | Result |
|---|---|
| Neutralized SMS action no longer sends from the browser | **PASS** — function makes no `fetch`; body references no key/provider |
| No request made to `textbelt.com` from the action | **PASS** — 0 `textbelt.com` requests captured across two invocations |
| Clear unavailable message (not a silent failure) | **PASS** — button → "SMS unavailable" (disabled) + tooltip + toast "Direct SMS is disabled — use 'Copy Cancel Link' to send manually." |
| Send-path key `TEXTBELT_KEY_1` present in browser source | **PASS** — absent (const removed) |
| Unrelated page functionality still works | **PASS** — `monCopyCancelLink` fallback intact; page renders (title "Rosalia Group — Dashboard") |
| No Textbelt key present anywhere in browser source | **PARTIAL** — send path clean, but the `monLoadSmsCredits` **quota panel still embeds both key literals** (2 `textbelt.com/quota` refs). Out of scope for the send-only fix; **resolved by rotating both keys** (§8). Recommend a follow-up to move quota checks server-side. |

Note: the string `textbelt.com/text` still appears once in source — it is the **explanatory comment** in the neutralized function, not a live call (verified: the function makes no fetch).
