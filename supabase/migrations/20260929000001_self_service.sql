alter type public.pickup_method add value if not exists 'SELF_SERVICE';

alter table public.reservations
  add column self_service_state text not null default 'NONE' check (self_service_state in ('NONE', 'REQUESTED', 'APPROVED', 'DECLINED', 'FALLBACK', 'STARTED', 'RETURNED')),
  add column self_service_note text,
  add column self_service_reviewed_by uuid references public.staff_members (user_id) on delete set null,
  add column self_service_reviewed_at timestamptz,
  add column access_link text,
  add column access_note text,
  add column self_reminder_2d_at timestamptz,
  add column self_reminder_1d_at timestamptz,
  add column self_started_at timestamptz,
  add column self_returned_at timestamptz,
  add column self_return_key_card boolean;

create index reservations_self_service_idx on public.reservations (self_service_state, pickup_at) where self_service_state <> 'NONE';

create table public.self_service_photos (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  phase text not null check (phase in ('PICKUP', 'RETURN')),
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

create index self_service_photos_reservation_idx on public.self_service_photos (reservation_id, phase);

alter table public.self_service_photos enable row level security;
revoke all on public.self_service_photos from anon;
grant select on public.self_service_photos to authenticated, service_role;
grant insert, update, delete on public.self_service_photos to service_role;

create policy self_service_photos_staff_read on public.self_service_photos
for select to authenticated using ((select public.is_staff()));
