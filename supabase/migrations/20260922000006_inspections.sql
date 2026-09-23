create type public.inspection_kind as enum ('PICKUP', 'RETURN');

create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete restrict,
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  kind public.inspection_kind not null,
  odometer integer not null check (odometer >= 0),
  battery_level integer not null check (battery_level between 0 and 100),
  accessories jsonb not null default '{}'::jsonb,
  checklist jsonb not null default '{}'::jsonb,
  charges jsonb not null default '[]'::jsonb,
  damage_notes text,
  renter_remarks text,
  performed_by uuid references public.staff_members (user_id) on delete set null,
  performed_at timestamptz not null default now(),
  unique (reservation_id, kind)
);

create table public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null default 0,
  created_at timestamptz not null default now()
);

create index inspection_photos_inspection_idx on public.inspection_photos (inspection_id);

alter table public.inspections enable row level security;
alter table public.inspection_photos enable row level security;
revoke all on public.inspections, public.inspection_photos from anon;

create policy inspections_staff_read on public.inspections
for select to authenticated using ((select public.is_staff()));

create policy inspection_photos_staff_read on public.inspection_photos
for select to authenticated using ((select public.is_staff()));

create policy inspections_customer_read on public.inspections
for select to authenticated using (
  exists (select 1 from public.reservations r where r.id = reservation_id and r.customer_id = (select public.current_customer_id()))
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('inspection-photos', 'inspection-photos', false, 15728640)
on conflict (id) do nothing;
