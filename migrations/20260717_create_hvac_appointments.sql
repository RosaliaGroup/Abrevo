-- Mechanical Enterprise — Supabase migration
-- Creates the Mechanical-only `hvac_appointments` table written by
-- functions/book-hvac.js.
--
-- APPLY ONLY in the Mechanical Supabase project (MECHANICAL_SUPABASE_URL).
-- Do NOT run this against the shared Rosalia/Abrevo project.
-- Do NOT run in production without explicit approval — staging first.

create table if not exists public.hvac_appointments (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  phone             text,
  email             text,
  preferred_date    text,
  preferred_time    text,
  appointment_type  text,
  property_type     text,
  property_address  text,
  issue_description  text,
  budget            text,
  calendar_event_id text,
  sms_provider      text,
  sms_message_id    text,
  source            text not null default 'vapi',
  status            text not null default 'scheduled',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Indexes.
-- NOTE: `phone` is stored as received from Vapi (the function normalizes to
-- E.164 only for the SMS send). If strictly-normalized phone lookups are needed
-- later, add a normalized generated column + index as a follow-up.
create index if not exists idx_hvac_appointments_phone
  on public.hvac_appointments (phone);
create index if not exists idx_hvac_appointments_preferred_date
  on public.hvac_appointments (preferred_date);
create index if not exists idx_hvac_appointments_calendar_event_id
  on public.hvac_appointments (calendar_event_id);
create index if not exists idx_hvac_appointments_created_at
  on public.hvac_appointments (created_at);

-- Keep updated_at current on UPDATE.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_hvac_appointments_updated_at on public.hvac_appointments;
create trigger trg_hvac_appointments_updated_at
  before update on public.hvac_appointments
  for each row execute function public.set_updated_at();

-- Row Level Security: enabled. The Netlify function writes with the service_role
-- key, which bypasses RLS. No anon/public policies are granted here.
alter table public.hvac_appointments enable row level security;
