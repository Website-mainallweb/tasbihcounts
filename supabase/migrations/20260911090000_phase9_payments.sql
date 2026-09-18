-- =============================================================================
-- Phase 9 — what the payment reconciler needs from the database.
--
-- docs/ARCHITECTURE.md §4: the webhook advances a state machine, and every retry
-- resumes wherever the last attempt stopped. These rules make the machine
-- impossible to run backwards or to rewrite, whoever is holding the service key.
-- =============================================================================

-- The reconciler has an email from Razorpay and needs to know whether that buyer
-- already has an account — a second purchase, or a retry after the user was
-- created. The Data API cannot read auth.users, and listing every user to find
-- one is both slow and a needless exposure. Server only.
create function public.find_user_id_by_email(target_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(target_email)
  limit 1;
$$;
revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

-- -----------------------------------------------------------------------------
-- A purchase row: what was ordered never changes, and its state only moves on
-- -----------------------------------------------------------------------------

create function private.purchase_state_rank(s public.purchase_state)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case s
    when 'created'            then 0
    when 'payment_verified'   then 1
    when 'captured'           then 2
    when 'user_created'       then 3
    when 'entitlement_active' then 4
    when 'notified'           then 5
    else null                              -- failed_recoverable, refunded, revoked
  end;
$$;
revoke all on function private.purchase_state_rank(public.purchase_state) from public;

create function private.guard_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was integer := private.purchase_state_rank(old.state);
  now_ integer := private.purchase_state_rank(new.state);
begin
  -- The order itself is a fact from the moment it was created. The amount the
  -- webhook checks against comes from this row, so nothing may rewrite it.
  if new.order_id <> old.order_id
     or new.plan_id <> old.plan_id
     or new.expected_amount <> old.expected_amount
     or new.expected_currency <> old.expected_currency
     or new.mode <> old.mode
     or new.checkout_email <> old.checkout_email then
    raise exception 'what was ordered cannot change' using errcode = '42501';
  end if;

  -- Refunded and revoked are final.
  if old.state in ('refunded', 'revoked') and new.state <> old.state then
    if not (old.state = 'refunded' and new.state = 'revoked') then
      raise exception 'purchase % is %; it cannot become %', old.order_id, old.state, new.state
        using errcode = '42501';
    end if;
  end if;

  -- Forward only between the happy-path states. A retry that lands on an older
  -- state is a stale worker, not a correction.
  if was is not null and now_ is not null and now_ < was then
    raise exception 'purchase % cannot go back from % to %', old.order_id, old.state, new.state
      using errcode = '42501';
  end if;

  -- Once a buyer is attached, the purchase stays theirs. Account deletion clears
  -- it through the foreign key (on delete set null), which does not fire this
  -- check as a change of owner.
  if old.user_id is not null and new.user_id is not null and new.user_id <> old.user_id then
    raise exception 'purchase % already belongs to an account', old.order_id using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.guard_purchase() from public;

drop trigger if exists purchases_touch on public.purchases;
create trigger purchases_guard
  before update on public.purchases
  for each row execute function private.guard_purchase();

create index purchases_state_idx on public.purchases (state) where state not in ('notified', 'refunded', 'revoked');
