-- Migration: sms_sends — server-only log for cancel-link SMS rate limiting and
-- duplicate-send protection. Additive; alters no existing table. Apply in Supabase
-- before deploying the authenticated API.
--
-- Written/read ONLY by the server (service_role) from functions/api.js.
-- RLS enabled with NO policies -> anon/authenticated clients get no access.

create table if not exists public.sms_sends (
  id       bigint generated always as identity primary key,
  phone    text        not null,
  kind     text        not null,
  ip       text,
  sent_at  timestamptz not null default now()
);

create index if not exists idx_sms_sends_phone_kind_time
  on public.sms_sends (phone, kind, sent_at);
create index if not exists idx_sms_sends_ip_time
  on public.sms_sends (ip, sent_at);

alter table public.sms_sends enable row level security;
-- Intentionally no policies: only the service_role key (server) may access this table.
