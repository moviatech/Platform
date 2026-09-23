create table public.media (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('VIDEO', 'IMAGE')),
  scope text not null check (scope in ('PICKUP', 'RETURN', 'PREP')),
  reservation_id uuid references public.reservations (id) on delete set null,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  inspection_id uuid references public.inspections (id) on delete set null,
  prep_task_id uuid,
  storage_key text not null unique,
  content_type text not null,
  size_bytes bigint not null default 0,
  duration_seconds integer,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index media_inspection_idx on public.media (inspection_id);
create index media_vehicle_idx on public.media (vehicle_id, created_at desc);
create index media_expires_idx on public.media (expires_at) where expires_at is not null;

alter table public.media enable row level security;
revoke all on public.media from anon;
grant select on public.media to authenticated, service_role;
grant insert, update, delete on public.media to service_role;

create policy media_staff_read on public.media
for select to authenticated using ((select public.is_staff()));
