-- =============================================================================
-- Phase 11 — reminders.
--
-- docs/SECURITY.md §8: an FCM token identifies a device. It is bound to the
-- signed-in user, removed on sign-out, dropped when FCM calls it stale, and never
-- accepted for a user_id taken from a request body.
-- =============================================================================

-- One row per browser installation that allowed notifications.
create table public.push_installations (
  user_id    uuid not null references auth.users on delete cascade,
  -- The counter's own install id, so re-registering the same browser replaces
  -- its token instead of adding a second device.
  source_id  text not null check (char_length(source_id) between 1 and 128),
  token      text not null check (char_length(token) between 20 and 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source_id)
);
-- A token belongs to one installation at a time. If it moves (a shared browser
-- signed in as someone else), the old row goes; both must not get reminders.
create unique index push_installations_token_idx on public.push_installations (token);

create trigger push_installations_touch before update on public.push_installations
  for each row execute function private.touch_updated_at();

alter table public.push_installations enable row level security;
revoke all on public.push_installations from anon, authenticated;
-- A user can see which of their devices are registered and remove one. The token
-- column is never readable by them, and they never write a row directly:
-- claim_push_token() below is the only way in.
grant select (user_id, source_id, created_at, updated_at) on public.push_installations to authenticated;
grant delete on public.push_installations to authenticated;

create policy "push: see own devices"
  on public.push_installations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "push: remove own device"
  on public.push_installations for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Register this browser for the caller. SECURITY DEFINER because a token can move
-- between accounts on a shared browser, and the previous owner's row is invisible
-- to the new one under RLS — it has to be removed on their behalf, and only here.
create function public.claim_push_token(p_source text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not private.has_premium(uid) then
    raise exception 'premium required' using errcode = '42501';
  end if;
  if p_source is null or char_length(p_source) not between 1 and 128
     or p_token is null or char_length(p_token) not between 20 and 4096 then
    raise exception 'invalid registration' using errcode = '22023';
  end if;

  delete from public.push_installations
   where token = p_token and not (user_id = uid and source_id = p_source);

  insert into public.push_installations (user_id, source_id, token)
  values (uid, p_source, p_token)
  on conflict (user_id, source_id) do update set token = excluded.token;
end
$$;
revoke all on function public.claim_push_token(text, text) from public, anon;
grant execute on function public.claim_push_token(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- When and whether to remind
-- -----------------------------------------------------------------------------

create table public.reminder_settings (
  user_id        uuid primary key references auth.users on delete cascade,
  enabled        boolean not null default false,
  -- An IANA zone name from the browser, so "9 PM" is the user's 9 PM.
  zone           text not null default 'Asia/Kolkata' check (char_length(zone) between 1 and 64),
  -- Minutes after local midnight: 1260 is 9 PM.
  remind_at      smallint not null default 1260 check (remind_at between 0 and 1439),
  -- The local day a reminder last went out (or was skipped as unneeded), so the
  -- scheduler never sends twice in a day.
  last_sent_day  date,
  updated_at     timestamptz not null default now()
);

create trigger reminder_settings_touch before update on public.reminder_settings
  for each row execute function private.touch_updated_at();

-- The zone must be one Postgres knows, or local times cannot be computed.
create function private.guard_reminder_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.zone) then
    raise exception 'unknown time zone %', new.zone using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function private.guard_reminder_zone() from public;

create trigger reminder_settings_zone
  before insert or update of zone on public.reminder_settings
  for each row execute function private.guard_reminder_zone();

alter table public.reminder_settings enable row level security;
revoke all on public.reminder_settings from anon, authenticated;
grant select on public.reminder_settings to authenticated;
grant insert (user_id, enabled, zone, remind_at), update (enabled, zone, remind_at) on public.reminder_settings to authenticated;

create policy "reminders: read own"
  on public.reminder_settings for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "reminders: create own, premium only"
  on public.reminder_settings for insert to authenticated
  with check ((select auth.uid()) = user_id and private.has_premium((select auth.uid())));

create policy "reminders: change own"
  on public.reminder_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Who the scheduler should consider: reminders on, Premium active in the current
-- mode, and at least one registered device. Server only — the private schema is
-- not reachable through the Data API, so the premium check is done here.
create function public.reminder_candidates()
returns table (user_id uuid, zone text, remind_at smallint, last_sent_day date)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, r.zone, r.remind_at, r.last_sent_day
  from public.reminder_settings r
  where r.enabled
    and private.has_premium(r.user_id)
    and exists (select 1 from public.push_installations p where p.user_id = r.user_id);
$$;
revoke all on function public.reminder_candidates() from public, anon, authenticated;
grant execute on function public.reminder_candidates() to service_role;
