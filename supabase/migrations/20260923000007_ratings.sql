create type public.rating_kind as enum ('CONVERSATION', 'PICKUP', 'RETURN', 'VEHICLE', 'TRIP');

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  kind public.rating_kind not null,
  score smallint not null check (score between 1 and 5),
  comment text,
  customer_id uuid references public.customers (id) on delete set null,
  reservation_id uuid references public.reservations (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  staff_user_id uuid references public.staff_members (user_id) on delete set null,
  source text not null check (source in ('PORTAL', 'DEVICE', 'SURVEY')),
  created_at timestamptz not null default now()
);

create unique index ratings_conversation_idx on public.ratings (conversation_id) where conversation_id is not null;
create unique index ratings_reservation_kind_idx on public.ratings (reservation_id, kind, coalesce(staff_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) where reservation_id is not null;
create index ratings_staff_idx on public.ratings (staff_user_id, created_at desc);
create index ratings_created_idx on public.ratings (created_at desc);

alter table public.ratings enable row level security;
revoke all on public.ratings from anon;

create policy ratings_staff_read on public.ratings
for select to authenticated using ((select public.is_staff()));

create policy ratings_customer_read on public.ratings
for select to authenticated using (customer_id = (select public.current_customer_id()));

create table public.trip_surveys (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  token text not null unique,
  sent_at timestamptz,
  completed_at timestamptz,
  recommend_score smallint check (recommend_score between 0 and 10),
  recommend_reason text,
  created_at timestamptz not null default now()
);

alter table public.trip_surveys enable row level security;
revoke all on public.trip_surveys from anon;

create policy trip_surveys_staff_read on public.trip_surveys
for select to authenticated using ((select public.is_staff()));

alter table public.conversations add column ended_at timestamptz;
alter table public.conversations add column ended_by text check (ended_by in ('CUSTOMER', 'STAFF'));
