alter table public.reservations
  add column price_reviewed_at timestamptz,
  add column price_reviewed_by uuid references public.staff_members (user_id) on delete set null;

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('REFUND', 'CAPTURE', 'CHARGE', 'DISCOUNT')),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  reason text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DECLINED', 'FAILED')),
  requested_by uuid references public.staff_members (user_id) on delete set null,
  decided_by uuid references public.staff_members (user_id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  result jsonb,
  created_at timestamptz not null default now()
);

create index approvals_status_idx on public.approvals (status, created_at desc);

alter table public.approvals enable row level security;
revoke all on public.approvals from anon;
grant select on public.approvals to authenticated, service_role;
grant insert, update, delete on public.approvals to service_role;

create policy approvals_staff_read on public.approvals
for select to authenticated using ((select public.is_staff()));
