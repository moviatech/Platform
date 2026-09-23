create table public.damage_claims (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  inspection_id uuid references public.inspections (id) on delete set null,
  customer_id uuid not null references public.customers (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  description text,
  status text not null default 'PENDING_CONSENT' check (status in ('PENDING_CONSENT', 'CONSENTED', 'DISPUTED', 'CHARGED', 'INSURANCE', 'CLOSED')),
  consent_at timestamptz,
  consent_ip text,
  consent_user_agent text,
  consent_text text,
  dispute_note text,
  payment_id uuid references public.payments (id) on delete set null,
  staff_note text,
  decided_by uuid references public.staff_members (user_id) on delete set null,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index damage_claims_reservation_idx on public.damage_claims (reservation_id);
create index damage_claims_status_idx on public.damage_claims (status, created_at desc);

create table public.shift_notes (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.vehicle_service_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  kind text not null check (kind in ('MAINTENANCE', 'TIRES', 'REPAIR', 'RECALL', 'ACCIDENT', 'OTHER')),
  performed_on date not null,
  odometer integer,
  cost_cents integer not null default 0,
  vendor text,
  notes text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index vehicle_service_logs_vehicle_idx on public.vehicle_service_logs (vehicle_id, performed_on desc);

alter table public.damage_claims enable row level security;
alter table public.shift_notes enable row level security;
alter table public.vehicle_service_logs enable row level security;
revoke all on public.damage_claims, public.shift_notes, public.vehicle_service_logs from anon;
grant select on public.damage_claims, public.shift_notes, public.vehicle_service_logs to authenticated, service_role;
grant insert, update, delete on public.damage_claims, public.shift_notes, public.vehicle_service_logs to service_role;

create policy damage_claims_staff_read on public.damage_claims
for select to authenticated using ((select public.is_staff()));

create policy shift_notes_staff_read on public.shift_notes
for select to authenticated using ((select public.is_staff()));

create policy vehicle_service_logs_staff_read on public.vehicle_service_logs
for select to authenticated using ((select public.is_staff()));
