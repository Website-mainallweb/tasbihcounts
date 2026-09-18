-- =============================================================================
-- Phase 10 — sync.
--
-- The client tracks time on the mala per (day, name), in the same component as
-- the count (src/lib/counter/outbox.ts). A separate per-day timer component could
-- only ever be uploaded as a sum of whichever names happened to be dirty in one
-- request — and GREATEST over a partial sum silently keeps a stale total. So
-- time moves onto the per-name component, where it rises with everything else.
-- timer_components is dropped: it is empty, and one source of truth per fact.
--
-- History uploaded once from each device's pre-sync records lives under the
-- reserved source 'local-history' (docs/SPEC.md §6, revised 2026-09-10).
-- =============================================================================

alter table public.counter_components
  add column ms bigint not null default 0 check (ms between 0 and 86400000);

create or replace function private.guard_counter_component()
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
    -- Components only rise (SPEC §5): count, rounds and time alike.
    new.count  := greatest(old.count, new.count);
    new.rounds := greatest(old.rounds, new.rounds);
    new.ms     := greatest(old.ms, new.ms);
  end if;

  if exists (select 1 from private.account_tombstones t where t.user_id = new.user_id) then
    raise exception 'account deleted' using errcode = '42501';
  end if;

  if new.day > today + 1 or new.day < (today - interval '5 years')::date then
    raise exception 'day % is outside the accepted window', new.day using errcode = '22008';
  end if;

  if tg_op = 'INSERT' then
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

drop table public.timer_components;
drop function private.guard_timer_component();

-- -----------------------------------------------------------------------------
-- What everyone else contributed
-- -----------------------------------------------------------------------------

-- Per day and name, the sums the caller's device does not hold itself, in two
-- kinds:
--   'devices'  every other installation's own component — added to this
--              device's count
--   'history'  the shared 'local-history' source — compared with this device's
--              own pre-sync record, never added to it (SPEC §6, revised)
--
-- SECURITY INVOKER: it runs as the signed-in user, so row-level security limits
-- it to their own rows exactly as a plain select would. It adds a sum, not a
-- privilege.
create function public.sync_others(p_source text, p_days date[] default null, p_since date default null)
returns table (day date, naam_id text, kind text, count bigint, rounds bigint, ms bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.day,
         c.naam_id,
         case when c.source_id = 'local-history' then 'history' else 'devices' end as kind,
         sum(c.count)::bigint,
         sum(c.rounds)::bigint,
         sum(c.ms)::bigint
  from public.counter_components c
  where c.user_id = auth.uid()
    and c.source_id <> p_source
    and (p_days is null or c.day = any (p_days))
    and (p_since is null or c.day >= p_since)
  group by c.day, c.naam_id, 3
  order by c.day, c.naam_id, 3;
$$;
revoke all on function public.sync_others(text, date[], date) from public, anon;
grant execute on function public.sync_others(text, date[], date) to authenticated;
