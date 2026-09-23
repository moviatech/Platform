create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('STAFF', 'CUSTOMER')),
  customer_id uuid references public.customers (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete cascade,
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  href text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_staff_idx on public.notifications (created_at desc) where audience = 'STAFF';
create index notifications_customer_idx on public.notifications (customer_id, created_at desc);

alter table public.notifications enable row level security;
grant all on public.notifications to service_role;
