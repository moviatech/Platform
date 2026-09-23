alter table public.reservations add column spouse_driver boolean not null default false;
alter table public.reservation_drivers add column spouse boolean not null default false;
