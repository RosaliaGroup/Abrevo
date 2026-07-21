# Phase 2.6 — Browser Credential Containment (crm.html) + Rotation Runbook

**Date:** 2026-07-20 · **Status:** `crm.html` de-keyed and routed through a server wrapper; `rosalia.html` Textbelt quota literals removed. **No credential rotated. Nothing pushed/merged/deployed. No SMS.**

## 1. Inventory of direct privileged browser operations (crm.html, before)
`crm.html` embedded a Supabase **`service_role`** JWT (`SB_KEY`) and hit PostgREST directly. Operations:

| # | Table / op | R/W | Filters / payload | Triggered by | Less-priv path existed? | Server replacement |
|---|---|---|---|---|---|---|
| 1 | `leads?order=created_at.desc&limit=500` | R | — | Leads page load / dashboard | No | `GET action=leads` |
| 2 | `agents?order=name.asc` | R | — | Agents page / dropdowns | No | `GET action=agents` |
| 3 | `deals?order=created_at.desc` | R | — | Pipeline load | No | `GET action=deals` |
| 4 | `commissions?order=created_at.desc` | R | — | Commissions load | No | `GET action=commissions` |
| 5 | `bookings?preferred_date=gte..lte.&limit=100` | R | date range | Dashboard | No | `GET action=bookings&from&to` |
| 6 | `activities?lead_id=eq.ID&limit=20` | R | lead id | Lead detail | No | `GET action=activities&lead_id` |
| 7 | `tasks?order=due_date.asc` | R | — | Tasks load | No | `GET action=tasks` |
| 8 | `follow_up_sequences?order=name.asc` | R | — | Sequences load | No | `GET action=sequences` |
| 9 | `tasks?id=eq.ID` PATCH | W | `{status:'completed',completed_at}` | "Complete task" | No | `POST action=completeTask,id` |
| 10 | `commissions?id=eq.ID` PATCH | W | `{status:'paid',paid_at}` | "Mark paid" | No | `POST action=payCommission,id` |
| 11 | `leads` POST | W | lead fields | "Add lead" save | No | `POST action=createLead,data` |
| 12 | `deals` POST | W | deal fields | "Add deal" save | No | `POST action=createDeal,data` |
| 13 | `tasks` POST | W | task fields | "Add task" save | No | `POST action=createTask,data` |
| 14 | `agents` POST | W | agent fields | "Add agent" save | No | `POST action=createAgent,data` |

Tables touched: `leads, agents, deals, commissions, bookings, activities, tasks, follow_up_sequences` (all confirmed to exist — the page uses them against production).

## 2. Root cause
There was never a server API layer for the CRM: the browser **was** the privileged database client, holding the `service_role` key (which bypasses RLS and grants full DB access). Anyone viewing source could extract the key and read/write the entire database.

## 3. Server wrappers created
- `functions/_lib/crmData.js` — service: **fixed** read queries (client cannot pass PostgREST filters), per-table **column whitelists** for writes, server-set `created_at`, **id/date format validation**, normalized errors (no raw DB error/credential leaked). Injectable `fetch` for tests.
- `functions/crm-data.js` — HTTP dispatcher. Service-role key **server-side only** (env). **Optional access gate:** if `CRM_API_TOKEN` is set, requires header `x-crm-token` (else open, matching current unauthenticated Abrevo posture). Returns minimal fields (write → `{id}`; reads → rows).

**Access-control note:** matching current architecture, the endpoint is unauthenticated by default. This already removes the catastrophic issue (no extractable full-DB key in the browser). **Recommended hardening:** set `CRM_API_TOKEN` and/or enable Netlify site-password / Identity on `/crm`.

## 4. crm.html — exact behavior before/after
- **Before:** `const SB_KEY='<service_role JWT>'`; `sb(path,opts)` → `fetch(SB_URL+'/rest/v1/'+path, {headers:{apikey,Authorization:Bearer}})`. 17 direct call sites. Key visible in page source.
- **After:** `SB_URL`/`SB_KEY`/`SB_HEADERS`/`sb()` **removed**. New `crmGet(action,params)` / `crmPost(action,payload)` call `/.netlify/functions/crm-data`. All 17 sites rewritten. On failure a dismissible red error banner (`showCrmError`) is shown (previously failures were silent). Layout, tables, kanban, modals, and **`tel:` Call + `sms:` Text buttons are unchanged** (sms: buttons deliberately preserved for the later Communications pilot). No credential in the page (verified: 0 `eyJhbGci`, 0 `service_role`, 0 `Authorization`, 0 `/rest/v1`).

## 5. Textbelt environment-variable usage inventory
Two env vars in active code (values not shown). `ed89fc4` moved active functions to env vars; literals survive only in `rosalia.html` (now removed), dead/backup copies, a doc, and Git history.

| Env var | Active functions using it |
|---|---|
| `TEXTBELT_KEY` | autocall, book-hvac, cincwebhook, followup, fubsync, healthcheck, hvac-outreach, outbound, parsefubemail, readmail, reschedule-hvac, reschedule, respondrosalia, sendForm, sendsurvey, sms-campaign-hvac (16) |
| `TEXTBELT_KEY_2` | book-appointment, book, cancel, healthcheck (4) |

No additional aliases found. **Historical commits containing literal values:** `50caab5` (and predecessors) before `ed89fc4` "remove all hardcoded API keys"; `rosalia.html` literals present until this branch. Both key values remain in Git history.

## 6. Rotation runbook (manual — do NOT execute without explicit authorization)

### Supabase `service_role` (highest priority)
⚠️ **The same `service_role` key is still embedded in 4 other active pages** (`cancel-reschedule.html`, `mechanical.html`, `rosalia.html`, `social.html`). **Revoking it now would break those pages.** Give them the same server-wrapper treatment (or at least de-key them) BEFORE revoking.
1. In Supabase → Project Settings → API/JWT, generate a **new** service-role secret (see mechanism note below).
2. Set the new value in **Netlify env** (`SUPABASE_SERVICE_KEY`) — server context only; do **not** put it in any HTML/bundle.
3. Verify no browser bundle/HTML contains it: `grep -rE 'eyJhbGci|service_role' *.html` → expect only files intentionally deferred; goal is **zero** active pages.
4. Test the server wrappers (`crm-data`, and later the other pages' wrappers) against staging.
5. **Revoke/rotate** the exposed key.
6. Confirm the old key is rejected (a request with the old key returns 401 from Supabase).

**Supabase mechanism note:** Supabase's legacy `anon`/`service_role` JWTs are derived from the project **JWT secret**; rotating the JWT secret rotates **both** keys simultaneously (it does not rotate only the service key). Newer projects support **API keys** (publishable/secret) that can be rolled independently. Confirm which model this project uses; if legacy JWT, plan for the `anon` key to change too (update any anon usage in the same window). Do not guess — verify in the dashboard before rotating.

### Textbelt
1. Generate/obtain replacement Textbelt key(s).
2. Update **Netlify env** `TEXTBELT_KEY` and `TEXTBELT_KEY_2` (server only).
3. Verify the 19 functions still reference env vars only: `grep -rE '0672a5cd|06aa74dc' functions/` → expect **none**.
4. Revoke the exposed keys in the Textbelt dashboard.
5. Confirm old-key rejection (quota/text call with the old key fails).
6. Keep replacements only until each function migrates to Telnyx (Phase 3+), then remove.

## 7. Remaining browser-credential matches (classified)
| Location | Match | Class | Action |
|---|---|---|---|
| `crm.html` | — | **FIXED** | none |
| `rosalia.html` | Textbelt key literals | **FIXED** (removed) | Supabase `service_role` JWT still present → see below |
| `cancel-reschedule.html`, `mechanical.html`, `rosalia.html`, `social.html` | `service_role` JWT (same key) | **ACTIVE — out of Phase 2.6 scope** | give the same server-wrapper treatment before rotating |
| `netlify/functions/*`, `backups/*`, `ABREVO-FINAL-BACKUP-*` | service_role JWT + Textbelt literals | **DEAD** (not built; `netlify.toml` builds `functions/` only) | scrub or ignore; rotation moots them |
| `ROSALIA-SYSTEM-GUIDE.md` | Textbelt literal | **DOC** | scrub |
| Git history | all of the above | **HISTORY** | rotation is the real fix; optional history scrub |
