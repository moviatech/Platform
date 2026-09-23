alter table public.locations add column web_booking boolean not null default false;

update public.locations
set web_booking = true
where id = (select id from public.locations where active order by created_at limit 1);
