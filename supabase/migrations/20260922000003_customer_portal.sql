alter table public.customers
  add column identity_status text not null default 'PENDING' check (identity_status in ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED')),
  add column identity_session_id text,
  add column identity_verified_at timestamptz,
  add column identity_error text,
  add column license_expires_on date,
  add column license_last4 text,
  add column license_state text;

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  template_version text not null,
  locale text not null,
  terms_snapshot text not null,
  terms_hash text not null,
  signer_name text not null,
  signer_ip text,
  user_agent text,
  signed_at timestamptz not null default now()
);

create index agreements_customer_idx on public.agreements (customer_id);

alter table public.agreements enable row level security;
revoke all on public.agreements from anon;

create policy agreements_staff_read on public.agreements
for select to authenticated using ((select public.is_staff()));

create function public.current_customer_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.customers where auth_user_id = (select auth.uid()) limit 1;
$$;

create policy customers_self_read on public.customers
for select to authenticated using (auth_user_id = (select auth.uid()));

create policy reservations_customer_read on public.reservations
for select to authenticated using (customer_id = (select public.current_customer_id()));

create policy reservation_line_items_customer_read on public.reservation_line_items
for select to authenticated using (
  exists (select 1 from public.reservations r where r.id = reservation_id and r.customer_id = (select public.current_customer_id()))
);

create policy payments_customer_read on public.payments
for select to authenticated using (customer_id = (select public.current_customer_id()));

create policy agreements_customer_read on public.agreements
for select to authenticated using (customer_id = (select public.current_customer_id()));

create policy vehicle_classes_authenticated_read on public.vehicle_classes
for select to authenticated using (true);

create policy locations_authenticated_read on public.locations
for select to authenticated using (true);

create policy vehicles_customer_read on public.vehicles
for select to authenticated using (
  exists (select 1 from public.reservations r where r.assigned_vehicle_id = id and r.customer_id = (select public.current_customer_id()) and r.status = 'ACTIVE')
);
