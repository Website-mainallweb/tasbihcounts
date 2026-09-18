-- "Most chanted" was listing `_day`, which is not a name.
--
-- `_day` is the reserved id the account link uses for practice recorded before
-- the counter tracked names at all: a whole day's taps, as one lump, belonging
-- to no name (site/src/lib/counter/account-link.ts). Those japs are real and
-- stay in the totals — but as a row in a list of names it is meaningless, and
-- its link opens a name page that does not exist.
--
-- Only `top_names` changes. Everything else in admin_analytics() is as it was.

create or replace function public.admin_analytics()
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

    -- Practice that belongs to no name, kept as its own number rather than
    -- dropped: the screen can then say how much of the total is unattributed
    -- instead of quietly not adding up.
    'unnamed_japs', (select coalesce(sum(count), 0) from public.counter_components
                      where naam_id = '_day'),

    'top_names', coalesce((
      select jsonb_agg(t) from (
        select naam_id,
               sum(count)::bigint as japs,
               count(distinct user_id)::bigint as people
        from public.counter_components
        -- The reserved id, and nothing else. A custom mantra (c1789…) is
        -- somebody's own and still belongs here: it is a name, just not ours.
        where naam_id <> '_day'
        group by naam_id
        order by japs desc
        limit 15
      ) t
    ), '[]'::jsonb),

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
