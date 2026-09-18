-- Phases B–E of the admin back-office (docs/ADMIN.md).
--
-- Everything the panel needs from the database that it cannot simply select.
-- Three kinds of thing:
--
--   * Functions over `auth.users` and `private.*`, which PostgREST does not
--     expose. Each is SECURITY DEFINER with an empty search_path and is granted
--     to service_role alone — the panel's role, and nobody else's.
--   * Two tables the panel owns and the public site reads: the kill switches and
--     the name library.
--   * The guarantees those tables must keep whatever a future screen asks of
--     them, written as constraints rather than as intentions.
--
-- The rules from the Phase 7 migration still hold: RLS on at creation, explicit
-- grants after an explicit revoke, SECURITY DEFINER pins search_path to ''.

-- =============================================================================
-- Payment mode (docs/ADMIN.md §3.7)
-- =============================================================================

-- Which Razorpay mode grants Premium right now. Going live is currently a
-- hand-written UPDATE on a table nothing can reach through the API; these two
-- functions are what let it be a screen instead.
create function public.admin_payment_mode()
returns public.payment_mode
language sql
stable
security definer
set search_path = ''
as $$
  select payment_mode from private.app_config where id;
$$;
revoke all on function public.admin_payment_mode() from public, anon, authenticated;
grant execute on function public.admin_payment_mode() to service_role;

-- Returns the mode that was in force BEFORE the change, so the caller can write
-- both halves of it into the audit log without a second read that might race.
create function public.admin_set_payment_mode(new_mode public.payment_mode)
returns public.payment_mode
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.payment_mode;
begin
  select payment_mode into previous from private.app_config where id for update;
  update private.app_config set payment_mode = new_mode where id;
  return previous;
end
$$;
revoke all on function public.admin_set_payment_mode(public.payment_mode) from public, anon, authenticated;
grant execute on function public.admin_set_payment_mode(public.payment_mode) to service_role;

-- =============================================================================
-- Kill switches and feature flags (docs/ADMIN.md §3.8)
-- =============================================================================

-- The public site reads these, so unlike everything else here they are readable
-- by anon. There is nothing secret in "are ads on"; the secret would be in being
-- able to change it.
--
-- The key is a closed list, and that is the important line in this file. The
-- product's promise is that the counter keeps counting when every optional
-- system is off, so there must be no way to create a switch that turns the
-- counter off — not through a future admin screen, not by accident, not by
-- someone in a hurry. Adding a switch takes a migration, which is reviewed.
create table public.app_flags (
  key        text primary key check (key in (
               'payments',
               'google_login',
               'cloud_sync',
               'reminders',
               'ads',
               'promo_bar',
               'maintenance_mode'
             )),
  enabled    boolean not null default true,
  -- Shown on the switch itself, so the screen explains what turning it off does
  -- without the explanation living in a component somewhere else.
  note       text not null check (char_length(note) between 1 and 300),
  updated_at timestamptz not null default now()
);

create trigger app_flags_touch before update on public.app_flags
  for each row execute function private.touch_updated_at();

alter table public.app_flags enable row level security;
revoke all on public.app_flags from public, anon, authenticated;
grant select on public.app_flags to anon, authenticated;
grant select, update on public.app_flags to service_role;

-- Readable by everyone, writable by nobody who is not the server.
create policy "flags: anyone may read"
  on public.app_flags for select to anon, authenticated
  using (true);

insert into public.app_flags (key, enabled, note) values
  ('payments',         true,  'Off: the Premium page stops offering checkout. Existing buyers keep everything.'),
  ('google_login',     true,  'Off: the Google button disappears. Email sign-in still works.'),
  ('cloud_sync',       true,  'Off: devices stop uploading and downloading. Every device keeps counting locally.'),
  ('reminders',        true,  'Off: the scheduler sends nothing. Settings are remembered.'),
  ('ads',              true,  'Off: no ad slot renders anywhere.'),
  ('promo_bar',        true,  'Off: the announcement bar stays hidden.'),
  ('maintenance_mode', false, 'On: signed-in pages show a notice. The counter itself is never affected.');

-- =============================================================================
-- The name library (docs/ADMIN.md §3.9)
-- =============================================================================

-- What the counter offers to chant. It lived in site/src/lib/counter/names.ts;
-- that file stays as the offline fallback, and this table is what the site
-- actually renders when it can reach the database.
--
-- The id is the load-bearing column. Every count anyone has ever recorded is
-- stored under it, in their browser and in counter_components. Change an id and
-- that history is orphaned — silently, with no error anywhere. So the id cannot
-- be changed after creation and a row cannot be deleted at all; a name that
-- should no longer be offered is unpublished, and the history stays readable.
create table public.names (
  id              text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 64),
  devanagari      text not null check (char_length(devanagari) between 1 and 300),
  transliteration text not null check (char_length(transliteration) between 1 and 300),
  meaning         text not null check (char_length(meaning) between 1 and 300),
  -- 'mantra' groups the longer ones into their own section; null is a plain name.
  grp             text check (grp in ('mantra')),
  -- What order the library shows them in. Not unique: reordering a list through
  -- a unique column means a dance of temporary values for no benefit.
  position        integer not null check (position between 0 and 100000),
  published       boolean not null default true,
  updated_at      timestamptz not null default now()
);

create index names_order_idx on public.names (position) where published;

create function private.guard_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id <> old.id then
    raise exception 'a name id is permanent: counts are stored under it (docs/ADMIN.md §3.9)'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.guard_name() from public;

create trigger names_guard before insert or update on public.names
  for each row execute function private.guard_name();

-- Deletion is refused for everyone, service_role included. Unpublish instead.
create function private.names_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a name is never deleted, only unpublished (docs/ADMIN.md §3.9)'
    using errcode = '42501';
end
$$;
revoke all on function private.names_no_delete() from public;

create trigger names_no_delete before delete on public.names
  for each row execute function private.names_no_delete();

alter table public.names enable row level security;
revoke all on public.names from public, anon, authenticated;
grant select on public.names to anon, authenticated;
grant select, insert, update on public.names to service_role;

-- Visitors see published names. An unpublished one is invisible to everyone but
-- the panel, which reads as service_role.
create policy "names: anyone may read published"
  on public.names for select to anon, authenticated
  using (published);

-- =============================================================================
-- Dashboard (docs/ADMIN.md §3.1)
-- =============================================================================

-- Captured payments with no matching active entitlement (docs/ADMIN.md §3.1).
--
-- Deliberately not "purchases in a bad state": a purchase can look finished and
-- the entitlement still be missing, and it is the entitlement that decides what
-- the buyer can actually do. A purchase whose account was deleted by its owner
-- is not a failure and is left out.
create function public.admin_reconciliation()
returns table (
  order_id       text,
  payment_id     text,
  checkout_email text,
  user_id        uuid,
  state          public.purchase_state,
  amount         integer,
  paid_at        timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select pu.order_id, pa.payment_id, pu.checkout_email, pu.user_id, pu.state, pa.amount, pa.created_at
  from public.payments pa
  join public.purchases pu on pu.order_id = pa.order_id
  join private.app_config c on c.id
  where pa.status = 'captured'
    and pa.mode = c.payment_mode
    -- A refund or a deliberate revocation is a decision, not a failure.
    and pu.state not in ('refunded', 'revoked')
    and case
          when pu.user_id is null then
            -- The purchase has no account attached, and the tombstone cannot be
            -- consulted: deleting an account sets this column to null, so there
            -- is no id left to look the tombstone up by. The state is what
            -- distinguishes the two ways that happens. 'notified' and
            -- 'entitlement_active' mean the account was created, worked, and was
            -- later deleted by its owner — not a failure. Anything earlier means
            -- the money arrived and no account was ever made, which is the worst
            -- version of this bug and must not be filtered out by accident.
            pu.state not in ('notified', 'entitlement_active')
          else
            not exists (
              select 1 from public.entitlements e
              where e.user_id = pu.user_id and e.status = 'active' and e.mode = c.payment_mode
            )
        end
  order by pa.created_at desc;
$$;

-- One round trip for the numbers at the top of the panel. Written as one query
-- per number rather than one clever join: these are small tables, and a
-- dashboard that is subtly wrong is worse than a dashboard that is slow.
create function public.admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mode', (select payment_mode from private.app_config where id),

    'accounts',          (select count(*) from auth.users),
    'accounts_confirmed',(select count(*) from auth.users where email_confirmed_at is not null),
    'signups_today',     (select count(*) from auth.users where created_at >= date_trunc('day', now())),
    'signups_7d',        (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'signups_30d',       (select count(*) from auth.users where created_at >= now() - interval '30 days'),

    -- Premium means an active entitlement in the mode that is in force. A
    -- test-mode entitlement stops counting the moment the site goes live, which
    -- is exactly what the live dashboard should show.
    'premium', (
      select count(*) from public.entitlements e
      join private.app_config c on c.id
      where e.status = 'active' and e.mode = c.payment_mode
    ),

    -- Money actually received, in paise, in the current mode. Captured only:
    -- an authorised payment is not money until it is captured.
    'revenue_paise', (
      select coalesce(sum(p.amount), 0) from public.payments p
      join private.app_config c on c.id
      where p.status = 'captured' and p.mode = c.payment_mode
    ),
    'refunded_paise', (
      select coalesce(sum(p.amount), 0) from public.payments p
      join private.app_config c on c.id
      where p.status = 'refunded' and p.mode = c.payment_mode
    ),

    -- Purchases that started and never reached an end state. Some are simply
    -- abandoned checkouts; the reconciliation list below is the subset that
    -- actually cost someone money.
    'purchases_open', (
      select count(*) from public.purchases
      where state not in ('notified', 'refunded', 'revoked')
    ),

    'webhook_events', (select count(*) from public.webhook_events),
    'reminders_on',   (select count(*) from public.reminder_settings where enabled),
    'devices',        (select count(*) from public.push_installations),

    -- The number that matters most on the page. Anything but zero is a person
    -- who paid and did not get what they paid for.
    'unreconciled', (select count(*) from public.admin_reconciliation())
  );
$$;

revoke all on function public.admin_overview() from public, anon, authenticated;
revoke all on function public.admin_reconciliation() from public, anon, authenticated;
grant execute on function public.admin_overview() to service_role;
grant execute on function public.admin_reconciliation() to service_role;

-- =============================================================================
-- Users (docs/ADMIN.md §3.2)
-- =============================================================================

-- The user list. One SQL query rather than paging Supabase's Auth API and
-- joining in JavaScript, which cannot filter or sort across the join at all.
--
-- `q` matches the email as a substring, case-insensitively. `filter` is one of
-- 'all', 'premium', 'free', 'unconfirmed'. An unrecognised filter means 'all'
-- rather than an error: a stale bookmark should show the list, not a stack trace.
create function public.admin_users(q text, filter text, lim integer, off integer)
returns table (
  id            uuid,
  email         text,
  created_at    timestamptz,
  confirmed_at  timestamptz,
  last_sign_in  timestamptz,
  banned_until  timestamptz,
  premium       boolean,
  purchases     bigint,
  total_rows    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with mode as (select payment_mode from private.app_config where id),
  base as (
    select
      u.id,
      u.email::text,
      u.created_at,
      u.email_confirmed_at as confirmed_at,
      u.last_sign_in_at    as last_sign_in,
      u.banned_until,
      exists (
        select 1 from public.entitlements e, mode m
        where e.user_id = u.id and e.status = 'active' and e.mode = m.payment_mode
      ) as premium,
      (select count(*) from public.purchases p where p.user_id = u.id) as purchases
    from auth.users u
    where (q is null or q = '' or u.email ilike '%' || q || '%')
  ),
  filtered as (
    select * from base
    where case lower(coalesce(filter, 'all'))
            when 'premium'     then premium
            when 'free'        then not premium
            when 'unconfirmed' then confirmed_at is null
            else true
          end
  )
  select f.*, (select count(*) from filtered) as total_rows
  from filtered f
  order by f.created_at desc
  limit greatest(least(coalesce(lim, 50), 200), 1)
  offset greatest(coalesce(off, 0), 0);
$$;

-- Everything one user's detail page shows, in one call.
--
-- What it deliberately does not return: any counter history. Support never needs
-- to read somebody's practice to answer a question about their payment, so there
-- is no route here that could. Only the shape of it — how many names, how many
-- days, when they last synced.
create function public.admin_user(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when u.id is null then null else jsonb_build_object(
    'id',           u.id,
    'email',        u.email,
    'created_at',   u.created_at,
    'confirmed_at', u.email_confirmed_at,
    'last_sign_in', u.last_sign_in_at,
    'banned_until', u.banned_until,

    'premium', exists (
      select 1 from public.entitlements e, private.app_config c
      where e.user_id = u.id and e.status = 'active' and e.mode = c.payment_mode and c.id
    ),

    'entitlements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'plan_id', e.plan_id, 'mode', e.mode, 'status', e.status,
               'order_id', e.order_id, 'granted_at', e.granted_at)
             order by e.granted_at desc)
      from public.entitlements e where e.user_id = u.id
    ), '[]'::jsonb),

    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', p.order_id, 'state', p.state, 'mode', p.mode,
               'amount', p.expected_amount, 'currency', p.expected_currency,
               'email', p.checkout_email, 'created_at', p.created_at)
             order by p.created_at desc)
      from public.purchases p where p.user_id = u.id
    ), '[]'::jsonb),

    'devices', coalesce((select count(*) from public.push_installations d where d.user_id = u.id), 0),

    'reminder', (
      select jsonb_build_object('enabled', r.enabled, 'zone', r.zone, 'at', r.remind_at,
                                'last_sent_day', r.last_sent_day)
      from public.reminder_settings r where r.user_id = u.id
    ),

    -- The shape of their synced data, not its contents.
    'sync', jsonb_build_object(
      'names', (select count(distinct naam_id) from public.counter_components c where c.user_id = u.id),
      'days',  (select count(distinct day)     from public.counter_components c where c.user_id = u.id),
      'rows',  (select count(*)                from public.counter_components c where c.user_id = u.id),
      'last',  (select max(updated_at)         from public.counter_components c where c.user_id = u.id),
      'settings_updated', (select s.updated_at from public.user_settings s where s.user_id = u.id)
    )
  ) end
  from auth.users u where u.id = target;
$$;

revoke all on function public.admin_users(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_user(uuid) from public, anon, authenticated;
grant execute on function public.admin_users(text, text, integer, integer) to service_role;
grant execute on function public.admin_user(uuid) to service_role;

-- =============================================================================
-- Entitlements, by hand (docs/ADMIN.md §3.6)
-- =============================================================================

-- Granting Premium without a payment, and taking it away.
--
-- These exist for the support case the product will actually get: somebody paid
-- with one email and signed in with another. The panel requires a reason for
-- either, and writes both the reason and the previous state to the audit log —
-- that is the whole justification for a function that can hand out the paid
-- tier for free.
--
-- Returns the previous status, or null if there was no entitlement at all, so
-- the caller can log what it changed rather than what it hoped to change.
create function public.admin_grant_entitlement(target uuid, plan text, order_ref text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  mode_now public.payment_mode;
  previous text;
begin
  if target is null then
    raise exception 'no account given' using errcode = '22004';
  end if;
  if exists (select 1 from private.account_tombstones t where t.user_id = target) then
    raise exception 'that account was deleted by its owner' using errcode = '42501';
  end if;

  select payment_mode into mode_now from private.app_config where id;

  select e.status into previous
    from public.entitlements e
   where e.user_id = target and e.plan_id = plan and e.mode = mode_now;

  insert into public.entitlements (user_id, plan_id, mode, status, order_id)
  values (target, plan, mode_now, 'active', order_ref)
  on conflict (user_id, plan_id, mode)
  do update set status = 'active', order_id = coalesce(excluded.order_id, public.entitlements.order_id);

  return previous;
end
$$;

create function public.admin_revoke_entitlement(target uuid, plan text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  mode_now public.payment_mode;
  previous text;
begin
  select payment_mode into mode_now from private.app_config where id;

  select e.status into previous
    from public.entitlements e
   where e.user_id = target and e.plan_id = plan and e.mode = mode_now;

  -- Revoked, not deleted. "They never had it" and "we took it away" are
  -- different facts and the second one has to stay visible.
  update public.entitlements
     set status = 'revoked'
   where user_id = target and plan_id = plan and mode = mode_now;

  return previous;
end
$$;

revoke all on function public.admin_grant_entitlement(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_revoke_entitlement(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_grant_entitlement(uuid, text, text) to service_role;
grant execute on function public.admin_revoke_entitlement(uuid, text) to service_role;

-- =============================================================================
-- Analytics (docs/ADMIN.md §3.12)
-- =============================================================================

-- Every number here describes signed-in Premium users only, because only their
-- counts reach the server at all — free practice never leaves the browser, by
-- design. The screen says so out loud; this comment is here so that a future
-- reader of the SQL does not mistake it for site-wide truth either.
create function public.admin_analytics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'synced_users', (select count(distinct user_id) from public.counter_components),
    'synced_japs',  (select coalesce(sum(count), 0) from public.counter_components),
    'synced_rounds',(select coalesce(sum(rounds), 0) from public.counter_components),
    'active_7d',    (select count(distinct user_id) from public.counter_components
                      where updated_at >= now() - interval '7 days'),
    'active_30d',   (select count(distinct user_id) from public.counter_components
                      where updated_at >= now() - interval '30 days'),

    'top_names', coalesce((
      select jsonb_agg(t) from (
        select naam_id,
               sum(count)::bigint as japs,
               count(distinct user_id)::bigint as people
        from public.counter_components
        group by naam_id
        order by japs desc
        limit 15
      ) t
    ), '[]'::jsonb),

    -- The funnel the dashboard cares about: of everyone who made an account, how
    -- many paid. Visits are Google Analytics' business, not this table's.
    'funnel', jsonb_build_object(
      'accounts', (select count(*) from auth.users),
      'started',  (select count(distinct checkout_email) from public.purchases),
      'paid',     (select count(distinct pu.user_id) from public.purchases pu
                    join public.payments pa on pa.order_id = pu.order_id
                    where pa.status = 'captured')
    )
  );
$$;
revoke all on function public.admin_analytics() from public, anon, authenticated;
grant execute on function public.admin_analytics() to service_role;

-- =============================================================================
-- System (docs/ADMIN.md §3.13)
-- =============================================================================

-- Row counts, so the panel can show what the database is actually holding
-- without a screen-specific query for each table.
create function public.admin_table_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'users',              (select count(*) from auth.users),
    'purchases',          (select count(*) from public.purchases),
    'payments',           (select count(*) from public.payments),
    'webhook_events',     (select count(*) from public.webhook_events),
    'entitlements',       (select count(*) from public.entitlements),
    'counter_components', (select count(*) from public.counter_components),
    -- No timer_components: Phase 10 dropped it, one source of truth per fact.
    'user_settings',      (select count(*) from public.user_settings),
    'push_installations', (select count(*) from public.push_installations),
    'reminder_settings',  (select count(*) from public.reminder_settings),
    'names',              (select count(*) from public.names),
    'admin_audit',        (select count(*) from public.admin_audit),
    'tombstones',         (select count(*) from private.account_tombstones)
  );
$$;
revoke all on function public.admin_table_counts() from public, anon, authenticated;
grant execute on function public.admin_table_counts() to service_role;
