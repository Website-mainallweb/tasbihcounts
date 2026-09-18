-- =============================================================================
-- Phase 7 — schema, row-level security, and the rules the database keeps itself.
--
-- Sources for every constraint: docs/SPEC.md (days, limits, what syncs) and
-- docs/ARCHITECTURE.md §1 (per-device components), §3 M4/M6/M7/M8, §4 (payment
-- tables). docs/SECURITY.md §2 is why the rules below are written the way they are.
--
-- Rules for this file and every migration after it:
--   * A table enables row level security in the migration that creates it. RLS on
--     with no policy means anon and authenticated reach nothing; only service_role,
--     which bypasses RLS, does.
--   * A policy a user can write through carries both USING and WITH CHECK.
--   * Grants are explicit. Supabase grants ALL on every new public table and
--     function to anon and authenticated by default, so each one here revokes that
--     first and grants back only what is needed.
--   * A SECURITY DEFINER function pins search_path to ''.
-- tests/unit/db/rls.test.ts checks all four, and the isolation matrix, against a
-- real Postgres.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
-- Policies call private.has_premium(); the role evaluating a policy needs usage.
-- The private schema is not exposed through the Data API, so this grants no route
-- to its tables.
grant usage on schema private to authenticated, service_role;

create type public.payment_mode as enum ('test', 'live');

create type public.purchase_state as enum (
  'created',
  'payment_verified',
  'captured',
  'user_created',
  'entitlement_active',
  'notified',
  'failed_recoverable',
  'refunded',
  'revoked'
);

-- -----------------------------------------------------------------------------
-- Shared trigger: updated_at
-- -----------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.touch_updated_at() from public;

-- -----------------------------------------------------------------------------
-- Configuration the policies read
-- -----------------------------------------------------------------------------

-- Which Razorpay mode grants premium right now (ARCHITECTURE M6). One row. Going
-- live is a single update, and every test-mode entitlement stops counting at once.
create table private.app_config (
  id           boolean primary key default true check (id),
  payment_mode public.payment_mode not null default 'test'
);
alter table private.app_config enable row level security;
revoke all on private.app_config from public, anon, authenticated;
insert into private.app_config (id) values (true);

-- Deleted accounts (ARCHITECTURE M4). Not a foreign key: the user row is gone. A
-- late webhook, or a phone that was offline for a week, must not bring back the
-- data of an account its owner deleted.
create table private.account_tombstones (
  user_id    uuid primary key,
  deleted_at timestamptz not null default now()
);
alter table private.account_tombstones enable row level security;
revoke all on private.account_tombstones from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Payments (ARCHITECTURE §4). Written only by the server; see Phase 9.
-- -----------------------------------------------------------------------------

-- Our record of an order. The amount the webhook checks comes from this row,
-- never from a literal in the handler, and the price lives on the row so a later
-- plan can cost something else without touching earlier buyers.
create table public.purchases (
  order_id          text primary key check (order_id ~ '^order_[A-Za-z0-9]{6,40}$'),
  plan_id           text not null check (plan_id ~ '^[a-z0-9_]{1,64}$'),
  expected_amount   integer not null check (expected_amount > 0),
  expected_currency text not null check (expected_currency ~ '^[A-Z]{3}$'),
  mode              public.payment_mode not null,
  checkout_email    text not null check (
                      char_length(checkout_email) between 3 and 320
                      and checkout_email = lower(checkout_email)
                      and position('@' in checkout_email) > 1
                    ),
  state             public.purchase_state not null default 'created',
  user_id           uuid references auth.users on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index purchases_user_id_idx on public.purchases (user_id);
create index purchases_checkout_email_idx on public.purchases (checkout_email);
create trigger purchases_touch before update on public.purchases
  for each row execute function private.touch_updated_at();

alter table public.purchases enable row level security;
revoke all on public.purchases from anon, authenticated;
grant select on public.purchases to authenticated;
create policy "purchases: read own"
  on public.purchases for select to authenticated
  using ((select auth.uid()) = user_id);

-- A payment Razorpay reported, kept as a durable fact. The primary key is the
-- idempotency key: a second delivery of the same payment collides harmlessly.
-- Kept after the account is deleted, as tax law requires.
create table public.payments (
  payment_id text primary key check (payment_id ~ '^pay_[A-Za-z0-9]{6,40}$'),
  order_id   text not null references public.purchases (order_id),
  amount     integer not null check (amount > 0),
  currency   text not null check (currency ~ '^[A-Z]{3}$'),
  status     text not null check (status in ('authorized', 'captured', 'refunded', 'failed')),
  method     text check (char_length(method) <= 32),
  mode       public.payment_mode not null,
  created_at timestamptz not null default now()
);
create index payments_order_id_idx on public.payments (order_id);

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;

-- Every webhook delivery seen, deduplicated on Razorpay's event id.
create table public.webhook_events (
  event_id    text primary key check (char_length(event_id) between 1 and 128),
  event_type  text not null check (char_length(event_type) between 1 and 64),
  mode        public.payment_mode not null,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;

-- What a user is entitled to. Readable by its owner, written only by the server:
-- a user must never be able to grant themselves premium.
create table public.entitlements (
  user_id    uuid not null references auth.users on delete cascade,
  plan_id    text not null check (plan_id ~ '^[a-z0-9_]{1,64}$'),
  mode       public.payment_mode not null,
  status     text not null check (status in ('active', 'revoked')),
  order_id   text references public.purchases (order_id),
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_id, mode)
);
create trigger entitlements_touch before update on public.entitlements
  for each row execute function private.touch_updated_at();

alter table public.entitlements enable row level security;
revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;
create policy "entitlements: read own"
  on public.entitlements for select to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Premium, as the policies see it
-- -----------------------------------------------------------------------------

-- An active entitlement in the mode currently configured. Test-mode purchases do
-- not count once the site is live (ARCHITECTURE M6).
create function private.has_premium(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.entitlements e
    join private.app_config c on c.id
    where e.user_id = uid
      and e.status = 'active'
      and e.mode = c.payment_mode
  );
$$;
revoke all on function private.has_premium(uuid) from public;
grant execute on function private.has_premium(uuid) to authenticated, service_role;

-- The caller's own premium status, for the server to check before anything that
-- costs money. Takes no argument, so it cannot be used to ask about someone else.
create function public.my_premium()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_premium(auth.uid());
$$;
revoke all on function public.my_premium() from public, anon, authenticated;
grant execute on function public.my_premium() to authenticated;

-- -----------------------------------------------------------------------------
-- Counter components (ARCHITECTURE §1, SPEC §1, §5, §6, §7)
-- -----------------------------------------------------------------------------

-- One device's own contribution to one name on one day. The total is sum(count)
-- across sources; a component is uploaded as an absolute value and only rises.
create table public.counter_components (
  user_id        uuid not null references auth.users on delete cascade,
  day            date not null,
  naam_id        text not null check (char_length(naam_id) between 1 and 120),
  source_id      text not null check (char_length(source_id) between 1 and 128),
  count          bigint not null default 0 check (count between 0 and 10000000),
  rounds         bigint not null default 0 check (rounds between 0 and 10000000),
  -- Recorded, never read (SPEC §1): the insurance that lets days be rebuilt if
  -- the device-day rule ever has to change.
  zone           text check (char_length(zone) <= 64),
  offset_minutes smallint check (offset_minutes between -840 and 840),
  updated_at     timestamptz not null default now(),
  primary key (user_id, day, naam_id, source_id),
  -- Every round needs at least one tap.
  constraint rounds_within_count check (rounds <= count)
);

-- The rules no client can be trusted with. Runs for every role, service_role
-- included, because a bug in the server is as able to break them as a client is.
create function private.guard_counter_component()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today   date := (now() at time zone 'utc')::date;
  sources integer;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.day <> old.day
       or new.naam_id <> old.naam_id or new.source_id <> old.source_id then
      raise exception 'a component cannot be moved' using errcode = '42501';
    end if;
    -- Components only rise (SPEC §5). A lower value is a stale device, not a
    -- correction, so the higher one is kept rather than the write refused.
    new.count  := greatest(old.count, new.count);
    new.rounds := greatest(old.rounds, new.rounds);
  end if;

  if exists (select 1 from private.account_tombstones t where t.user_id = new.user_id) then
    raise exception 'account deleted' using errcode = '42501';
  end if;

  -- The clock clamp (SPEC §1): at most one day ahead of the server's UTC date,
  -- which covers UTC+14, and no more than five years back.
  if new.day > today + 1 or new.day < (today - interval '5 years')::date then
    raise exception 'day % is outside the accepted window', new.day using errcode = '22008';
  end if;

  if tg_op = 'INSERT' then
    -- At most 20 sources per (user, day, name) (SPEC §6). Locked so two
    -- concurrent inserts cannot both see 19. The source being written is left
    -- out of the count: an upsert of an existing source fires this trigger
    -- before its conflict turns it into an update, and must still succeed.
    perform pg_advisory_xact_lock(
      hashtextextended(new.user_id::text || '|' || new.day::text || '|' || new.naam_id, 0)
    );
    select count(*) into sources
      from public.counter_components c
     where c.user_id = new.user_id
       and c.day = new.day
       and c.naam_id = new.naam_id
       and c.source_id <> new.source_id;
    if sources >= 20 then
      raise exception 'too many sources for one day and name' using errcode = '54000';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.guard_counter_component() from public;

create trigger counter_components_guard
  before insert or update on public.counter_components
  for each row execute function private.guard_counter_component();

alter table public.counter_components enable row level security;
revoke all on public.counter_components from anon, authenticated;
-- No delete. History is erased only by deleting the account (SPEC §2).
grant select, insert, update on public.counter_components to authenticated;

create policy "components: read own"
  on public.counter_components for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "components: add own, premium only"
  on public.counter_components for insert to authenticated
  with check ((select auth.uid()) = user_id and private.has_premium((select auth.uid())));

create policy "components: raise own, premium only"
  on public.counter_components for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and private.has_premium((select auth.uid())));

-- -----------------------------------------------------------------------------
-- Timer components (SPEC §4, §7): milliseconds on the mala per device per day
-- -----------------------------------------------------------------------------

create table public.timer_components (
  user_id    uuid not null references auth.users on delete cascade,
  day        date not null,
  source_id  text not null check (char_length(source_id) between 1 and 128),
  ms         bigint not null default 0 check (ms between 0 and 86400000),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, source_id)
);

create function private.guard_timer_component()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today   date := (now() at time zone 'utc')::date;
  sources integer;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.day <> old.day or new.source_id <> old.source_id then
      raise exception 'a component cannot be moved' using errcode = '42501';
    end if;
    new.ms := greatest(old.ms, new.ms);
  end if;

  if exists (select 1 from private.account_tombstones t where t.user_id = new.user_id) then
    raise exception 'account deleted' using errcode = '42501';
  end if;

  if new.day > today + 1 or new.day < (today - interval '5 years')::date then
    raise exception 'day % is outside the accepted window', new.day using errcode = '22008';
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(
      hashtextextended(new.user_id::text || '|' || new.day::text || '|timer', 0)
    );
    select count(*) into sources
      from public.timer_components t
     where t.user_id = new.user_id
       and t.day = new.day
       and t.source_id <> new.source_id;
    if sources >= 20 then
      raise exception 'too many sources for one day' using errcode = '54000';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.guard_timer_component() from public;

create trigger timer_components_guard
  before insert or update on public.timer_components
  for each row execute function private.guard_timer_component();

alter table public.timer_components enable row level security;
revoke all on public.timer_components from anon, authenticated;
grant select, insert, update on public.timer_components to authenticated;

create policy "timers: read own"
  on public.timer_components for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "timers: add own, premium only"
  on public.timer_components for insert to authenticated
  with check ((select auth.uid()) = user_id and private.has_premium((select auth.uid())));

create policy "timers: raise own, premium only"
  on public.timer_components for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and private.has_premium((select auth.uid())));

-- -----------------------------------------------------------------------------
-- Settings that follow the user (SPEC §4): mala progress, custom mantras,
-- favourites, target, reminders, selected name, theme, language
-- -----------------------------------------------------------------------------

create table public.user_settings (
  user_id    uuid primary key references auth.users on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  version    bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  constraint settings_is_object check (jsonb_typeof(settings) = 'object'),
  constraint settings_size check (pg_column_size(settings) <= 65536)
);

create function private.guard_user_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.account_tombstones t where t.user_id = new.user_id) then
    raise exception 'account deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'settings cannot be moved' using errcode = '42501';
    end if;
    -- The server owns the version, so a client cannot rewind it.
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.guard_user_settings() from public;

create trigger user_settings_guard
  before insert or update on public.user_settings
  for each row execute function private.guard_user_settings();

alter table public.user_settings enable row level security;
revoke all on public.user_settings from anon, authenticated;
grant select, insert, update on public.user_settings to authenticated;

create policy "settings: read own"
  on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "settings: add own, premium only"
  on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = user_id and private.has_premium((select auth.uid())));

create policy "settings: change own, premium only"
  on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and private.has_premium((select auth.uid())));

-- -----------------------------------------------------------------------------
-- Deleting an account (ARCHITECTURE M4)
-- -----------------------------------------------------------------------------

-- Tombstone first, then the user: the cascade removes components, timers,
-- settings and entitlements; purchases keep their row with user_id cleared, and
-- payments stay, as the privacy policy says. Server only.
create function public.delete_account(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target is null then
    raise exception 'no account given' using errcode = '22004';
  end if;
  insert into private.account_tombstones (user_id) values (target)
    on conflict (user_id) do nothing;
  delete from auth.users where id = target;
end
$$;
revoke all on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
