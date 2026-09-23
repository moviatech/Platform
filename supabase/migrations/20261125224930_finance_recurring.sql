create table public.fin_recurring (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  category text not null check (category in ('CHARGING', 'CLEANING', 'INSURANCE', 'REGISTRATION', 'MAINTENANCE', 'TOLLS_TICKETS', 'PARKING', 'VEHICLE_FINANCE', 'PAYMENT_FEES', 'MARKETING', 'SOFTWARE', 'PAYROLL', 'RENT', 'OTHER')),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  every_months smallint not null default 1 check (every_months in (1, 3, 6, 12)),
  starts_on date not null,
  ends_on date,
  vendor text check (char_length(vendor) <= 160),
  vehicle_id uuid references public.vehicles (id) on delete set null,
  location_id uuid references public.locations (id) on delete restrict,
  method text not null default 'CARD' check (method in ('CARD', 'ACH', 'ZELLE', 'CASH', 'CHECK', 'OTHER')),
  paid_from text not null default 'COMPANY_ACCOUNT' check (paid_from in ('COMPANY_ACCOUNT', 'COMPANY_CARD', 'PERSONAL')),
  spread boolean not null default false,
  note text check (char_length(note) <= 1000),
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create table public.fin_recurring_skips (
  recurring_id uuid not null references public.fin_recurring (id) on delete cascade,
  due_on date not null,
  skipped_by uuid references public.staff_members (user_id) on delete set null,
  skipped_at timestamptz not null default now(),
  primary key (recurring_id, due_on)
);

create function public.fin_recurring_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id = old.id and new.starts_on = old.starts_on and new.every_months = old.every_months and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'fin_recurring_schedule_fixed';
end;
$$;

create trigger fin_recurring_fixed before update on public.fin_recurring
for each row execute function public.fin_recurring_guard();

alter table public.expenses
  add column recurring_id uuid references public.fin_recurring (id) on delete restrict,
  add column recurring_on date,
  add constraint expenses_recurring check ((recurring_id is null) = (recurring_on is null));

create unique index expenses_recurring_live_idx on public.expenses (recurring_id, recurring_on) where recurring_id is not null and voided_at is null;
create index expenses_recurring_idx on public.expenses (recurring_id) where recurring_id is not null;

create or replace function public.expenses_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'expenses_append_only';
  end if;
  if old.voided_at is null and new.voided_at is not null
    and new.id = old.id and new.spent_on = old.spent_on and new.category = old.category and new.amount_cents = old.amount_cents
    and new.vendor is not distinct from old.vendor and new.method = old.method
    and new.reference is not distinct from old.reference and new.note is not distinct from old.note
    and new.created_at = old.created_at
    and new.location_id is not distinct from old.location_id and new.service_from is not distinct from old.service_from
    and new.service_to is not distinct from old.service_to and new.capital = old.capital and new.paid_from = old.paid_from
    and new.vehicle_id is not distinct from old.vehicle_id
    and new.recurring_id is not distinct from old.recurring_id and new.recurring_on is not distinct from old.recurring_on then
    return new;
  end if;
  if new.voided_at is not distinct from old.voided_at and new.void_reason is not distinct from old.void_reason
    and new.id = old.id and new.spent_on = old.spent_on and new.category = old.category and new.amount_cents = old.amount_cents
    and new.vendor is not distinct from old.vendor and new.method = old.method
    and new.reference is not distinct from old.reference and new.note is not distinct from old.note
    and new.created_at = old.created_at
    and new.location_id is not distinct from old.location_id and new.service_from is not distinct from old.service_from
    and new.service_to is not distinct from old.service_to and new.capital = old.capital and new.paid_from = old.paid_from
    and new.vehicle_id is not distinct from old.vehicle_id
    and new.recurring_id is not distinct from old.recurring_id and new.recurring_on is not distinct from old.recurring_on then
    return new;
  end if;
  raise exception 'expenses_append_only';
end;
$$;

create table public.fin_settlements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('CARD_PAYMENT', 'REIMBURSEMENT')),
  paid_on date not null,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  reference text check (char_length(reference) <= 160),
  note text check (char_length(note) <= 1000),
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.staff_members (user_id) on delete set null,
  void_reason text check (char_length(void_reason) <= 500),
  check ((voided_at is null) = (void_reason is null))
);

create index fin_settlements_paid_on_idx on public.fin_settlements (paid_on desc);

create function public.fin_settlements_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'fin_settlements_append_only';
  end if;
  if new.id = old.id and new.kind = old.kind and new.paid_on = old.paid_on and new.amount_cents = old.amount_cents
    and new.reference is not distinct from old.reference and new.note is not distinct from old.note and new.created_at = old.created_at
    and ((old.voided_at is null and new.voided_at is not null)
      or (new.voided_at is not distinct from old.voided_at and new.void_reason is not distinct from old.void_reason)) then
    return new;
  end if;
  raise exception 'fin_settlements_append_only';
end;
$$;

create trigger fin_settlements_immutable before update or delete on public.fin_settlements
for each row execute function public.fin_settlements_guard();

alter table public.fin_recurring enable row level security;
alter table public.fin_recurring_skips enable row level security;
alter table public.fin_settlements enable row level security;

revoke all on table public.fin_recurring, public.fin_recurring_skips, public.fin_settlements from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.fin_recurring to service_role;
grant select, insert on table public.fin_recurring_skips to service_role;
grant select, insert, update on table public.fin_settlements to service_role;

revoke all on function public.expenses_guard() from public, anon, authenticated, service_role;
revoke all on function public.fin_recurring_guard() from public, anon, authenticated, service_role;
revoke all on function public.fin_settlements_guard() from public, anon, authenticated, service_role;
