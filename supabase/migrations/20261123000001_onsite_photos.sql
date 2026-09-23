alter table public.reservations add column license_onsite_photos text[] not null default '{}';
alter table public.reservation_drivers add column photo_paths text[] not null default '{}';

update public.reservations set license_onsite_photos = array[license_onsite_photo] where license_onsite_photo is not null;
update public.reservation_drivers set photo_paths = array[photo_path] where photo_path is not null;
