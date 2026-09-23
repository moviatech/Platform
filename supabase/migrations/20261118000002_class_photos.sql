create table public.vehicle_class_photos (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.vehicle_classes (id) on delete cascade,
  slot text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null default 0,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (class_id, slot)
);

alter table public.vehicle_class_photos enable row level security;
revoke all on public.vehicle_class_photos from anon, authenticated;
grant all on public.vehicle_class_photos to service_role;

alter table public.vehicle_classes add column video_url text;
