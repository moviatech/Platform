create type public.payment_kind as enum ('RENTAL', 'SECURITY_HOLD', 'ADDITIONAL', 'CANCELLATION_FEE');
create type public.payment_status as enum ('PENDING', 'REQUIRES_ACTION', 'AUTHORIZED', 'SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED', 'FAILED');

alter table public.customers add column stripe_payment_method_id text;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  kind public.payment_kind not null,
  status public.payment_status not null default 'PENDING',
  amount_cents integer not null check (amount_cents >= 0),
  amount_captured_cents integer not null default 0 check (amount_captured_cents >= 0),
  amount_refunded_cents integer not null default 0 check (amount_refunded_cents >= 0),
  currency text not null default 'usd',
  description text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_setup_intent_id text unique,
  stripe_payment_method_id text,
  checkout_url text,
  checkout_expires_at timestamptz,
  authorization_expires_at timestamptz,
  failure_code text,
  failure_message text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_reservation_idx on public.payments (reservation_id, created_at);
create index payments_status_idx on public.payments (kind, status);

create trigger payments_touch before update on public.payments
for each row execute function public.touch_updated_at();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  reason text,
  status text not null default 'PENDING',
  stripe_refund_id text unique,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index refunds_payment_idx on public.refunds (payment_id);

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text
);

alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.stripe_events enable row level security;

create policy payments_staff_read on public.payments for select to authenticated using ((select public.is_staff()));
create policy refunds_staff_read on public.refunds for select to authenticated using ((select public.is_staff()));

revoke all on public.payments, public.refunds, public.stripe_events from anon;

create function public.sync_reservation_payment_state(p_reservation_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_paid integer;
  v_refunded integer;
  v_hold public.hold_state;
begin
  select total_cents into v_total from public.reservations where id = p_reservation_id;

  select coalesce(sum(amount_captured_cents), 0), coalesce(sum(amount_refunded_cents), 0)
  into v_paid, v_refunded
  from public.payments
  where reservation_id = p_reservation_id and kind = 'RENTAL' and status in ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED');

  select case
    when bool_or(status = 'AUTHORIZED') then 'AUTHORIZED'
    when bool_or(status in ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')) then 'CAPTURED'
    when bool_or(status = 'CANCELLED') then 'RELEASED'
    when bool_or(status = 'FAILED') then 'FAILED'
    else 'NONE'
  end::public.hold_state
  into v_hold
  from public.payments
  where reservation_id = p_reservation_id and kind = 'SECURITY_HOLD';

  update public.reservations
  set payment_state = case
        when v_paid = 0 then 'UNPAID'
        when v_refunded >= v_paid then 'REFUNDED'
        when v_refunded > 0 then 'PARTIALLY_REFUNDED'
        when v_paid >= v_total then 'PAID'
        else 'PARTIALLY_PAID'
      end::public.payment_state,
      hold_state = coalesce(v_hold, 'NONE')
  where id = p_reservation_id;
end;
$$;

revoke all on function public.sync_reservation_payment_state(uuid) from public, anon, authenticated;
grant execute on function public.sync_reservation_payment_state(uuid) to service_role;
