-- Communications foundation (Phase 1) — conversations
-- Project: fhkgpepkwibxbxsepetd (Supabase). REVIEW ONLY — not applied remotely.
--
-- One conversation == one SMS thread with a person, keyed by their canonical
-- E.164 phone number. Uniqueness is on normalized_phone ALONE:
--   Abrevo is a single business account (no tenant/account dimension in the
--   data model; the only discriminator is a `client` text column of 'rosalia'
--   vs 'hvac' on leads/bookings, which is a per-record business line, not a
--   tenant boundary). A given phone number is one messaging thread regardless
--   of which business line it relates to; business-line context is captured by
--   linked entities (see conversation_links), not by the conversation key.
-- The UNIQUE index on normalized_phone is the concurrency-safety mechanism for
-- get-or-create: two racing inserts cannot both succeed; the loser re-selects.

create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id               uuid        primary key default gen_random_uuid(),
  normalized_phone text        not null,
  status           text        not null default 'open'
                   check (status in ('open', 'closed', 'archived')),
  opted_out_at     timestamptz null,
  created_by       text        null,   -- origin of creation, e.g. 'crm', 'book', 'inbound-webhook'
  last_message_at  timestamptz null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Concurrency-safe canonical-phone uniqueness (see header).
create unique index if not exists conversations_normalized_phone_key
  on public.conversations (normalized_phone);
