alter table public.customers add column license_kind text not null default 'US' check (license_kind in ('US', 'INTERNATIONAL', 'TRANSLATED'));

alter table public.reservations
  add column extra_drivers integer not null default 0 check (extra_drivers between 0 and 3),
  add column drivers_pending integer not null default 0 check (drivers_pending >= 0),
  add column insurance_state text not null default 'NOT_REQUIRED' check (insurance_state in ('NOT_REQUIRED', 'PENDING', 'UPLOADED', 'VERIFIED')),
  add column insurance_proof_path text,
  add column insurance_verified_by uuid references public.staff_members (user_id) on delete set null,
  add column insurance_verified_at timestamptz,
  add column license_onsite_photo text,
  add column license_onsite_by uuid references public.staff_members (user_id) on delete set null,
  add column license_onsite_at timestamptz;

update public.reservations set extra_drivers = 1, drivers_pending = case when status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED') then 1 else 0 end where add_ons @> array['driver']::text[];
update public.reservations set insurance_state = 'PENDING' where protection = 'none' and status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED');

create table public.reservation_drivers (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  position integer not null check (position between 1 and 3),
  status text not null default 'PENDING' check (status in ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'ONSITE')),
  international boolean not null default false,
  identity_session_id text unique,
  full_name text,
  license_last4 text,
  license_country text,
  license_expires_on date,
  photo_path text,
  verified_by uuid references public.staff_members (user_id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reservation_id, position)
);

create trigger reservation_drivers_touch before update on public.reservation_drivers
for each row execute function public.touch_updated_at();

alter table public.reservation_drivers enable row level security;
revoke all on public.reservation_drivers from anon;
create policy reservation_drivers_staff_read on public.reservation_drivers for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

insert into public.reservation_drivers (reservation_id, position, status)
select id, 1, case when status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED') then 'PENDING' else 'ONSITE' end
from public.reservations
where extra_drivers > 0;
