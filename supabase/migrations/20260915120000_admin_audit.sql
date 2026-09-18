-- Phase A of the admin back-office (docs/ADMIN.md §2).
--
-- One table: the record of what an administrator did. It exists because the
-- panel can grant Premium, revoke it, and delete an account — three things that
-- are invisible afterwards unless something wrote them down at the time.
--
-- It lives in `public` rather than `private` for the same reason `payments` and
-- `webhook_events` do: PostgREST only exposes `public`, and the service role has
-- to be able to write here. Row-level security is on with no policy at all, so
-- `anon` and `authenticated` see nothing — including the administrator's own
-- browser session, which reads this only through the server.

-- -----------------------------------------------------------------------------
-- The log
-- -----------------------------------------------------------------------------

create table public.admin_audit (
  id           bigint generated always as identity primary key,

  -- Who. The email is denormalised on purpose: it must survive the account it
  -- names being deleted, which is itself one of the actions recorded here. Hence
  -- no foreign key on actor_id either.
  actor_id     uuid,
  actor_email  text not null check (
                 char_length(actor_email) between 3 and 320
                 and actor_email = lower(actor_email)
               ),

  -- What. A stable machine name, not a sentence: 'entitlement.grant',
  -- 'account.delete', 'payment_mode.set'. Sentences drift and cannot be filtered.
  action       text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),

  -- Whom or what it was done to: a user id, an order id, a setting key. Free
  -- text, because the subjects are not all the same kind of thing.
  subject      text check (char_length(subject) <= 320),

  -- The change itself. Both nullable: a pure read that is worth logging has
  -- neither, and a creation has no `before`.
  before       jsonb,
  after        jsonb,

  -- Why, when the action demands a reason — a manual grant, a revocation.
  reason       text check (char_length(reason) <= 1000),

  -- Where from, as the proxy reported it. Useful exactly once: the day something
  -- happens that the operator does not remember doing.
  ip           text check (char_length(ip) <= 64),

  at           timestamptz not null default now(),

  constraint admin_audit_before_is_object check (before is null or jsonb_typeof(before) = 'object'),
  constraint admin_audit_after_is_object  check (after  is null or jsonb_typeof(after)  = 'object'),
  -- A log entry is not a place to park a payload. 8 KB is generous for a diff.
  constraint admin_audit_size check (
    coalesce(pg_column_size(before), 0) + coalesce(pg_column_size(after), 0) <= 8192
  )
);

create index admin_audit_at_idx on public.admin_audit (at desc);
create index admin_audit_action_idx on public.admin_audit (action, at desc);
create index admin_audit_subject_idx on public.admin_audit (subject) where subject is not null;

-- -----------------------------------------------------------------------------
-- Append-only, and meant
-- -----------------------------------------------------------------------------

-- Revoking UPDATE and DELETE is the first layer. It is not the last one: the
-- service role is the role this application uses, and a future migration that
-- grants it broadly would silently undo this.
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public, anon, authenticated;
revoke update, delete, truncate on public.admin_audit from service_role;
grant select, insert on public.admin_audit to service_role;

-- The layer that holds regardless of who is asking. A trigger fires for every
-- role, superuser included, so this is what actually makes the log evidence
-- rather than a note. Rewriting history now takes a migration — which is itself
-- a reviewed, committed, visible act, and that is the point.
create function private.admin_audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'public.admin_audit is append-only (docs/ADMIN.md §2)'
    using errcode = '42501';
end
$$;
revoke all on function private.admin_audit_append_only() from public;

create trigger admin_audit_no_update
  before update on public.admin_audit
  for each row execute function private.admin_audit_append_only();

create trigger admin_audit_no_delete
  before delete on public.admin_audit
  for each row execute function private.admin_audit_append_only();

-- Truncate skips row triggers entirely, so it needs its own statement trigger.
create trigger admin_audit_no_truncate
  before truncate on public.admin_audit
  for each statement execute function private.admin_audit_append_only();
