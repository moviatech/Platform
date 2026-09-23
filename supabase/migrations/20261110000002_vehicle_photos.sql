create table public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  slot text not null,
  visibility text not null check (visibility in ('CUSTOMER', 'INTERNAL')),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null default 0,
  note text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index vehicle_photos_slot_idx on public.vehicle_photos (vehicle_id, slot) where slot <> 'flaw';
create index vehicle_photos_vehicle_idx on public.vehicle_photos (vehicle_id, created_at);

alter table public.vehicle_photos enable row level security;
revoke all on public.vehicle_photos from anon, authenticated;
grant all on public.vehicle_photos to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('vehicle-archive', 'vehicle-archive', false, 20971520)
on conflict (id) do nothing;
