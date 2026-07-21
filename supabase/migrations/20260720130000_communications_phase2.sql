-- Communications Phase 2 — additive columns + RLS lockdown
-- Project: fhkgpepkwibxbxsepetd (Supabase). REVIEW ONLY — not applied remotely.
--
-- Additive to the Phase 1 tables (no destructive change):
--   * conversations.last_read_at          -> supports "mark read" / unread badge
--   * conversations.last_message_preview  -> list view preview without an N+1
--   * conversations.last_message_direction
--
-- RLS: the Communications tables are accessed ONLY by server-side Netlify
-- functions using the service-role key (which bypasses RLS by design). We ENABLE
-- RLS with NO permissive policies, so the anon/authenticated roles are denied by
-- default and no browser client (even one holding the anon key) can read or
-- write these tables. This is deliberately stricter than the rest of the current
-- Abrevo schema (see PHASE2-MIGRATION-REVIEW.md — crm.html currently ships a
-- service_role key to the browser, a separate pre-existing exposure we flag but
-- do not depend on).

alter table public.conversations
  add column if not exists last_read_at          timestamptz null,
  add column if not exists last_message_preview  text        null,
  add column if not exists last_message_direction text       null;

-- Backs the conversation-list ordering (last_message_at desc nulls last).
-- Recommended in the Phase 2 review; added here (still unapplied) before testing.
create index if not exists conversations_last_message_at_idx
  on public.conversations (last_message_at desc nulls last);

alter table public.conversations      enable row level security;
alter table public.messages           enable row level security;
alter table public.conversation_links enable row level security;

-- No policies are created: with RLS enabled and no policy, anon/authenticated
-- get zero rows and cannot write. service_role bypasses RLS for server use.
-- (Explicit revoke as defense-in-depth in case default privileges were granted.)
revoke all on public.conversations      from anon, authenticated;
revoke all on public.messages           from anon, authenticated;
revoke all on public.conversation_links from anon, authenticated;
