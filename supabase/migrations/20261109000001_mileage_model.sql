create type public.investor_compensation as enum ('REVENUE_SHARE', 'PER_MILE');
create type public.odometer_source as enum ('DELIVERY', 'TESLA', 'PICKUP', 'RETURN', 'MANUAL', 'SERVICE');
create type public.mileage_statement_status as enum ('DRAFT', 'ISSUED', 'DISPUTED', 'SETTLED', 'VOID');

alter type public.investor_ledger_type add value if not exists 'MILEAGE_FEE';

alter table public.investors
  add column compensation public.investor_compensation not null default 'REVENUE_SHARE',
  add column mileage_payout_days integer check (mileage_payout_days between 0 and 60);

alter table public.investor_withdrawals add column kind text not null default 'MANUAL' check (kind in ('MANUAL', 'AUTO'));

create table public.investor_mileage_rates (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete cascade,
  rate_cents integer not null check (rate_cents >= 0),
  effective_month date not null check (extract(day from effective_month) = 1),
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (investor_id, effective_month)
);

create table public.investor_mileage_statements (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete restrict,
  allocation_id uuid not null references public.investor_allocations (id) on delete restrict,
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  period_start timestamptz not null,
  period_end timestamptz not null,
  start_reading integer check (start_reading >= 0),
  end_reading integer check (end_reading >= 0),
  start_source public.odometer_source,
  end_source public.odometer_source,
  adjustment_miles integer not null default 0,
  qualifying_miles integer not null default 0 check (qualifying_miles >= 0),
  rate_cents integer not null check (rate_cents >= 0),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  status public.mileage_statement_status not null default 'DRAFT',
  final boolean not null default false,
  read_error text,
  issued_at timestamptz,
  issued_by uuid references public.staff_members (user_id) on delete set null,
  dispute_until timestamptz,
  disputed_at timestamptz,
  disputed_miles integer not null default 0 check (disputed_miles >= 0),
  dispute_note text,
  resolved_at timestamptz,
  resolved_by uuid references public.staff_members (user_id) on delete set null,
  accepted_miles integer check (accepted_miles >= 0),
  resolution_note text,
  entry_id uuid references public.investor_ledger_entries (id) on delete set null,
  disputed_entry_id uuid references public.investor_ledger_entries (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start)
);

create unique index investor_mileage_statements_period_idx on public.investor_mileage_statements (allocation_id, month) where status <> 'VOID';
create index investor_mileage_statements_investor_idx on public.investor_mileage_statements (investor_id, month desc);
create index investor_mileage_statements_status_idx on public.investor_mileage_statements (status, month desc);

create trigger investor_mileage_statements_touch before update on public.investor_mileage_statements
for each row execute function public.touch_updated_at();

create table public.investor_mileage_adjustments (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.investor_mileage_statements (id) on delete cascade,
  miles integer not null check (miles <> 0),
  kind text not null check (kind in ('OWNER_USE', 'REPOSITIONING', 'ODOMETER_ERROR', 'FRAUD', 'DISPUTE', 'OTHER')),
  reason text not null,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index investor_mileage_adjustments_statement_idx on public.investor_mileage_adjustments (statement_id, created_at);

create table public.vehicle_odometer_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  reading integer not null check (reading >= 0),
  source public.odometer_source not null,
  read_at timestamptz not null default now(),
  reservation_id uuid references public.reservations (id) on delete set null,
  statement_id uuid references public.investor_mileage_statements (id) on delete set null,
  note text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index vehicle_odometer_readings_idx on public.vehicle_odometer_readings (vehicle_id, read_at desc);

insert into public.vehicle_odometer_readings (vehicle_id, reading, source, read_at, note)
select id, odometer, 'MANUAL', now(), 'backfill'
from public.vehicles
where odometer is not null;

alter table public.investor_ledger_entries add column statement_id uuid references public.investor_mileage_statements (id) on delete set null;
create index investor_ledger_statement_idx on public.investor_ledger_entries (statement_id) where statement_id is not null;

create or replace function public.investor_ledger_guard() returns trigger
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
    and new.statement_id is not distinct from old.statement_id
    and new.metadata = old.metadata and new.created_by is not distinct from old.created_by and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'investor_ledger_append_only';
end;
$$;

create or replace function public.investor_post(p_investor_id uuid, p_entries jsonb) returns jsonb
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
      investor_id, type, bucket, amount_cents, settles_at, reservation_id, vehicle_id, allocation_id, contribution_id, withdrawal_id, reversal_of, statement_id, memo, metadata, created_by
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
      nullif(v_entry ->> 'statement_id', '')::uuid,
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

do $$
declare
  t text;
begin
  foreach t in array array['investor_mileage_rates', 'investor_mileage_statements', 'investor_mileage_adjustments', 'vehicle_odometer_readings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;
