create type public.investor_contribution_kind as enum ('CAPITAL', 'VEHICLE');
create type public.investor_contribution_status as enum ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED');
create type public.investor_allocation_status as enum ('ACTIVE', 'EXITING', 'ENDED');
create type public.investor_ledger_type as enum ('CAPITAL_IN', 'CAPITAL_ALLOCATED', 'RENTAL_SHARE', 'ADJUSTMENT', 'CAPITAL_RETURN', 'WITHHELD', 'WITHHOLD_RELEASE', 'WITHDRAWAL', 'REVERSAL');
create type public.investor_ledger_bucket as enum ('AVAILABLE', 'PENDING', 'INVESTED', 'PAID_OUT');
create type public.investor_withdrawal_status as enum ('REQUESTED', 'APPROVED', 'PAID', 'DECLINED', 'CANCELLED');
create type public.investor_hold_scope as enum ('ENTRY', 'VEHICLE', 'INVESTOR');
create type public.investor_exit_status as enum ('REQUESTED', 'IN_PROGRESS', 'RESOLVED', 'DECLINED');

create table public.investor_contributions (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete restrict,
  kind public.investor_contribution_kind not null,
  status public.investor_contribution_status not null default 'REQUESTED',
  amount_cents integer not null default 0 check (amount_cents >= 0),
  received_cents integer check (received_cents >= 0),
  vehicle_payload jsonb not null default '{}'::jsonb,
  note text,
  bank_reference text,
  decision_note text,
  decided_by uuid references public.staff_members (user_id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index investor_contributions_investor_idx on public.investor_contributions (investor_id, created_at desc);
create index investor_contributions_status_idx on public.investor_contributions (status, created_at desc);

create trigger investor_contributions_touch before update on public.investor_contributions
for each row execute function public.touch_updated_at();

create table public.investor_allocations (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete restrict,
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  contribution_id uuid references public.investor_contributions (id) on delete set null,
  source public.investor_contribution_kind not null,
  share_bps integer not null default 10000 check (share_bps between 1 and 10000),
  revenue_share_bps integer not null default 6000 check (revenue_share_bps between 0 and 10000),
  cost_basis_cents integer not null default 0 check (cost_basis_cents >= 0),
  effective_from date not null,
  effective_to date,
  status public.investor_allocation_status not null default 'ACTIVE',
  exit_note text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index investor_allocations_vehicle_active_idx on public.investor_allocations (vehicle_id) where status in ('ACTIVE', 'EXITING');
create index investor_allocations_investor_idx on public.investor_allocations (investor_id, status);

create trigger investor_allocations_touch before update on public.investor_allocations
for each row execute function public.touch_updated_at();

alter table public.investor_documents
  add constraint investor_documents_allocation_fkey foreign key (allocation_id) references public.investor_allocations (id) on delete set null;

create table public.investor_withdrawals (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete restrict,
  bank_account_id uuid not null references public.investor_bank_accounts (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  status public.investor_withdrawal_status not null default 'REQUESTED',
  approval_id uuid,
  reviewed_by uuid references public.staff_members (user_id) on delete set null,
  reviewed_at timestamptz,
  decision_note text,
  paid_by uuid references public.staff_members (user_id) on delete set null,
  paid_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index investor_withdrawals_investor_idx on public.investor_withdrawals (investor_id, created_at desc);
create index investor_withdrawals_status_idx on public.investor_withdrawals (status, created_at desc);

create trigger investor_withdrawals_touch before update on public.investor_withdrawals
for each row execute function public.touch_updated_at();

create table public.investor_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete restrict,
  type public.investor_ledger_type not null,
  bucket public.investor_ledger_bucket not null,
  amount_cents integer not null,
  settles_at timestamptz,
  settled_at timestamptz,
  reservation_id uuid references public.reservations (id) on delete set null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  allocation_id uuid references public.investor_allocations (id) on delete set null,
  contribution_id uuid references public.investor_contributions (id) on delete set null,
  withdrawal_id uuid references public.investor_withdrawals (id) on delete set null,
  reversal_of uuid references public.investor_ledger_entries (id) on delete restrict,
  memo text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index investor_ledger_investor_idx on public.investor_ledger_entries (investor_id, created_at desc);
create index investor_ledger_bucket_idx on public.investor_ledger_entries (bucket, settles_at) where bucket = 'PENDING';
create index investor_ledger_reservation_idx on public.investor_ledger_entries (reservation_id) where reservation_id is not null;
create index investor_ledger_vehicle_idx on public.investor_ledger_entries (vehicle_id, created_at desc) where vehicle_id is not null;
create unique index investor_ledger_rental_share_idx on public.investor_ledger_entries (reservation_id, allocation_id) where type = 'RENTAL_SHARE' and reversal_of is null;

create function public.investor_ledger_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'investor_ledger_append_only';
  end if;
  if old.bucket = 'PENDING' and new.bucket = 'AVAILABLE' and new.settled_at is not null
    and new.id = old.id and new.investor_id = old.investor_id and new.type = old.type and new.amount_cents = old.amount_cents
    and new.settles_at is not distinct from old.settles_at and new.reservation_id is not distinct from old.reservation_id
    and new.vehicle_id is not distinct from old.vehicle_id and new.allocation_id is not distinct from old.allocation_id
    and new.contribution_id is not distinct from old.contribution_id and new.withdrawal_id is not distinct from old.withdrawal_id
    and new.reversal_of is not distinct from old.reversal_of and new.memo is not distinct from old.memo
    and new.metadata = old.metadata and new.created_by is not distinct from old.created_by and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'investor_ledger_append_only';
end;
$$;

create trigger investor_ledger_immutable before update or delete on public.investor_ledger_entries
for each row execute function public.investor_ledger_guard();

create table public.investor_settlement_holds (
  id uuid primary key default gen_random_uuid(),
  scope public.investor_hold_scope not null,
  entry_id uuid references public.investor_ledger_entries (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete cascade,
  investor_id uuid references public.investors (id) on delete cascade,
  reason text not null,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  released_by uuid references public.staff_members (user_id) on delete set null,
  released_at timestamptz,
  release_note text,
  check (
    (scope = 'ENTRY' and entry_id is not null and vehicle_id is null and investor_id is null)
    or (scope = 'VEHICLE' and vehicle_id is not null and entry_id is null and investor_id is null)
    or (scope = 'INVESTOR' and investor_id is not null and entry_id is null and vehicle_id is null)
  )
);

create index investor_holds_active_idx on public.investor_settlement_holds (scope, created_at desc) where released_at is null;

create table public.investor_exit_requests (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete restrict,
  allocation_id uuid not null references public.investor_allocations (id) on delete restrict,
  reason text,
  status public.investor_exit_status not null default 'REQUESTED',
  resolved_by uuid references public.staff_members (user_id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index investor_exit_requests_investor_idx on public.investor_exit_requests (investor_id, created_at desc);
create index investor_exit_requests_status_idx on public.investor_exit_requests (status, created_at desc);

create trigger investor_exit_requests_touch before update on public.investor_exit_requests
for each row execute function public.touch_updated_at();

create view public.investor_balances as
select
  i.id as investor_id,
  coalesce(sum(case when e.bucket = 'AVAILABLE' then e.amount_cents end), 0)::integer as available_cents,
  coalesce(sum(case when e.bucket = 'PENDING' then e.amount_cents end), 0)::integer as pending_cents,
  coalesce(sum(case when e.bucket = 'INVESTED' then e.amount_cents end), 0)::integer as invested_cents,
  coalesce(sum(case when e.bucket = 'PAID_OUT' then e.amount_cents end), 0)::integer as withdrawn_cents,
  coalesce((select sum(w.amount_cents) from public.investor_withdrawals w where w.investor_id = i.id and w.status in ('REQUESTED', 'APPROVED')), 0)::integer as held_cents,
  (select count(*) from public.investor_allocations a where a.investor_id = i.id and a.status in ('ACTIVE', 'EXITING'))::integer as active_allocations
from public.investors i
left join public.investor_ledger_entries e on e.investor_id = i.id
group by i.id;

create function public.investor_post(p_investor_id uuid, p_entries jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_available bigint;
begin
  perform pg_advisory_xact_lock(hashtext('investor:' || p_investor_id::text));
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    insert into public.investor_ledger_entries (
      investor_id, type, bucket, amount_cents, settles_at, reservation_id, vehicle_id, allocation_id, contribution_id, withdrawal_id, reversal_of, memo, metadata, created_by
    ) values (
      p_investor_id,
      (v_entry ->> 'type')::public.investor_ledger_type,
      (v_entry ->> 'bucket')::public.investor_ledger_bucket,
      (v_entry ->> 'amount_cents')::integer,
      nullif(v_entry ->> 'settles_at', '')::timestamptz,
      nullif(v_entry ->> 'reservation_id', '')::uuid,
      nullif(v_entry ->> 'vehicle_id', '')::uuid,
      nullif(v_entry ->> 'allocation_id', '')::uuid,
      nullif(v_entry ->> 'contribution_id', '')::uuid,
      nullif(v_entry ->> 'withdrawal_id', '')::uuid,
      nullif(v_entry ->> 'reversal_of', '')::uuid,
      nullif(v_entry ->> 'memo', ''),
      coalesce(v_entry -> 'metadata', '{}'::jsonb),
      nullif(v_entry ->> 'created_by', '')::uuid
    )
    returning id into v_id;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;
  select coalesce(sum(amount_cents), 0) into v_available from public.investor_ledger_entries where investor_id = p_investor_id and bucket = 'AVAILABLE';
  if v_available < 0 then
    raise exception 'insufficient_available';
  end if;
  return v_ids;
end;
$$;

create function public.investor_settle_due() returns table (entry_id uuid, investor_id uuid, amount_cents integer, reservation_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select e.id
    from public.investor_ledger_entries e
    where e.bucket = 'PENDING'
      and e.settles_at is not null
      and e.settles_at <= now()
      and not exists (
        select 1 from public.investor_settlement_holds h
        where h.released_at is null
          and ((h.scope = 'ENTRY' and h.entry_id = e.id) or (h.scope = 'VEHICLE' and h.vehicle_id = e.vehicle_id) or (h.scope = 'INVESTOR' and h.investor_id = e.investor_id))
      )
  ), moved as (
    update public.investor_ledger_entries e
    set bucket = 'AVAILABLE', settled_at = now()
    from due
    where e.id = due.id
    returning e.id, e.investor_id, e.amount_cents, e.reservation_id
  )
  select moved.id, moved.investor_id, moved.amount_cents, moved.reservation_id from moved;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['investor_contributions', 'investor_allocations', 'investor_withdrawals', 'investor_ledger_entries', 'investor_settlement_holds', 'investor_exit_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

revoke all on public.investor_balances from anon, authenticated;
grant select on public.investor_balances to service_role;

revoke all on function public.investor_post(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.investor_post(uuid, jsonb) to service_role;
revoke all on function public.investor_settle_due() from public, anon, authenticated;
grant execute on function public.investor_settle_due() to service_role;
