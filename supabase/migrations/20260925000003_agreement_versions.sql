alter table public.agreements drop constraint if exists agreements_reservation_id_key;
alter table public.agreements add column version integer not null default 1;
alter table public.agreements add column superseded_at timestamptz;
create unique index agreements_reservation_version_idx on public.agreements (reservation_id, version);
