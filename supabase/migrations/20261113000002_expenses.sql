create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  category text not null check (category in ('CHARGING', 'CLEANING', 'INSURANCE', 'REGISTRATION', 'MAINTENANCE', 'TOLLS_TICKETS', 'PARKING', 'VEHICLE_FINANCE', 'PAYMENT_FEES', 'MARKETING', 'SOFTWARE', 'PAYROLL', 'RENT', 'OTHER')),
  amount_cents integer not null check (amount_cents > 0),
  vendor text,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  method text not null default 'CARD' check (method in ('CARD', 'ACH', 'ZELLE', 'CASH', 'CHECK', 'OTHER')),
  reference text,
  note text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.staff_members (user_id) on delete set null,
  void_reason text,
  check ((voided_at is null) = (void_reason is null))
);

create index expenses_spent_on_idx on public.expenses (spent_on desc);
create index expenses_vehicle_idx on public.expenses (vehicle_id, spent_on desc) where vehicle_id is not null;

create function public.expenses_guard() returns trigger
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
    and new.created_at = old.created_at then
    return new;
  end if;
  if new.voided_at is not distinct from old.voided_at and new.void_reason is not distinct from old.void_reason
    and new.id = old.id and new.spent_on = old.spent_on and new.category = old.category and new.amount_cents = old.amount_cents
    and new.vendor is not distinct from old.vendor and new.method = old.method
    and new.reference is not distinct from old.reference and new.note is not distinct from old.note
    and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'expenses_append_only';
end;
$$;

create trigger expenses_immutable before update or delete on public.expenses
for each row execute function public.expenses_guard();

alter table public.expenses enable row level security;
revoke all on table public.expenses from public, anon, authenticated;
grant all on table public.expenses to service_role;
revoke all on function public.expenses_guard() from public, anon, authenticated;
