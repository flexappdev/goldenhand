-- Golden Hand lead intake: Supabase schema.
-- Run once in the Supabase SQL editor (safe to re-run).
--
-- Security model
--   anon (the public site)   : INSERT a NEW lead only. Cannot read anything.
--   operators (signed in and : read leads and events; decide NEW leads via
--   listed in gh_operators)    gh_decide_lead(). No direct UPDATE/DELETE.
-- Every decision is stamped with the operator's email and logged.

create extension if not exists pgcrypto;

create table if not exists public.gh_operators (
  email text primary key check (email = lower(email))
);

create table if not exists public.gh_leads (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique check (ref ~ '^GH-[0-9]{6}-[A-Z0-9]{4}$'),
  created_at       timestamptz not null default now(),
  source           text not null default 'site' check (source in ('site','rapid')),
  name             text not null check (char_length(name) between 2 and 120),
  phone            text check (char_length(phone) <= 40),
  email            text check (char_length(email) <= 200),
  postcode         text check (char_length(postcode) <= 12),
  job              text not null check (char_length(job) between 10 and 2000),
  category         text not null,
  urgency          text not null default 'Flexible' check (urgency in ('Flexible','This week','Urgent (24h)')),
  preferred_window text not null default 'Flexible' check (preferred_window in ('Flexible','Morning','Afternoon','Evening')),
  consent          boolean not null check (consent),
  status           text not null default 'NEW' check (status in ('NEW','APPROVED','REJECTED')),
  decided_by       text,
  decided_at       timestamptz,
  decision_note    text check (char_length(decision_note) <= 1000),
  check (coalesce(phone,'') <> '' or coalesce(email,'') <> ''),
  check ((status = 'NEW') = (decided_by is null and decided_at is null))
);

create index if not exists gh_leads_status_created on public.gh_leads (status, created_at desc);

create table if not exists public.gh_lead_events (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.gh_leads(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       text not null,
  from_status text,
  to_status   text not null,
  note        text
);

-- Server owns created_at/status on insert, and logs the NEW event.
create or replace function public.gh_leads_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.status := 'NEW';
  new.decided_by := null;
  new.decided_at := null;
  new.decision_note := null;
  return new;
end $$;

create or replace function public.gh_leads_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into gh_lead_events (lead_id, actor, from_status, to_status)
  values (new.id, 'customer', null, 'NEW');
  return null;
end $$;

drop trigger if exists gh_leads_before_insert on public.gh_leads;
create trigger gh_leads_before_insert before insert on public.gh_leads
  for each row execute function public.gh_leads_on_insert();
drop trigger if exists gh_leads_after_insert on public.gh_leads;
create trigger gh_leads_after_insert after insert on public.gh_leads
  for each row execute function public.gh_leads_after_insert();

create or replace function public.gh_is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from gh_operators where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- The approval step. The only way a lead leaves NEW.
create or replace function public.gh_decide_lead(p_lead_id uuid, p_decision text, p_note text default null)
returns public.gh_leads
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_lead  gh_leads;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not gh_is_operator() then
    raise exception 'Only an approved operator can decide leads' using errcode = '42501';
  end if;
  if p_decision not in ('APPROVED','REJECTED') then
    raise exception 'Unknown decision %', p_decision using errcode = '22023';
  end if;
  if p_decision = 'REJECTED' and v_note is null then
    raise exception 'A note is required to reject a lead' using errcode = '22023';
  end if;
  select * into v_lead from gh_leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;
  if v_lead.status <> 'NEW' then
    raise exception 'Lead is already %', v_lead.status using errcode = '22023';
  end if;
  update gh_leads
     set status = p_decision, decided_by = v_actor, decided_at = now(), decision_note = v_note
   where id = p_lead_id
  returning * into v_lead;
  insert into gh_lead_events (lead_id, actor, from_status, to_status, note)
  values (p_lead_id, v_actor, 'NEW', p_decision, v_note);
  return v_lead;
end $$;

alter table public.gh_leads       enable row level security;
alter table public.gh_lead_events enable row level security;
alter table public.gh_operators   enable row level security;

drop policy if exists gh_leads_public_insert on public.gh_leads;
create policy gh_leads_public_insert on public.gh_leads
  for insert to anon, authenticated with check (status = 'NEW');

drop policy if exists gh_leads_operator_read on public.gh_leads;
create policy gh_leads_operator_read on public.gh_leads
  for select to authenticated using (public.gh_is_operator());

drop policy if exists gh_events_operator_read on public.gh_lead_events;
create policy gh_events_operator_read on public.gh_lead_events
  for select to authenticated using (public.gh_is_operator());

revoke all on public.gh_leads, public.gh_lead_events, public.gh_operators from anon, authenticated;
grant insert on public.gh_leads to anon, authenticated;
grant select on public.gh_leads, public.gh_lead_events to authenticated;
revoke all on function public.gh_decide_lead(uuid, text, text) from public, anon;
grant execute on function public.gh_decide_lead(uuid, text, text) to authenticated;
revoke all on function public.gh_is_operator() from public, anon;
grant execute on function public.gh_is_operator() to authenticated;

-- Add each operator (must also exist in Supabase Auth with a password):
-- insert into public.gh_operators (email) values ('operator@example.com') on conflict do nothing;
