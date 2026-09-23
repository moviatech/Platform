alter table public.locations
  add column support_phone text,
  add column support_email text,
  add column support_wechat text,
  add column support_hours text,
  add column support_hours_zh text;

create table public.staff_locations (
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

alter table public.conversations add column location_id uuid references public.locations (id) on delete set null;
create index conversations_location_idx on public.conversations (location_id, last_message_at desc) where location_id is not null;

alter table public.notifications add column location_id uuid references public.locations (id) on delete set null;
create index notifications_staff_location_idx on public.notifications (location_id, created_at desc) where audience = 'STAFF';

alter table public.shift_notes add column location_id uuid references public.locations (id) on delete set null;
alter table public.customers add column location_id uuid references public.locations (id) on delete set null;
create index customers_location_idx on public.customers (location_id) where location_id is not null;

alter table public.investors add column default_share_bps integer check (default_share_bps between 0 and 10000);

update public.conversations c
set location_id = r.pickup_location_id
from public.reservations r
where c.reservation_id = r.id and c.location_id is null;

update public.notifications n
set location_id = r.pickup_location_id
from public.reservations r
where n.audience = 'STAFF' and n.reservation_id = r.id and n.location_id is null;

create function public.staff_location_ids() returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.staff_locations where user_id = (select auth.uid()))
      then (select array_agg(location_id) from public.staff_locations where user_id = (select auth.uid()))
    else null
  end
$$;

create function public.is_hq_staff() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff() and public.staff_location_ids() is null
$$;

create function public.staff_sees_location(p_location uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null or (p_location is not null and p_location = any (public.staff_location_ids()))
$$;

create function public.staff_sees_vehicle(p_vehicle uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null
    or exists (select 1 from public.vehicles v where v.id = p_vehicle and v.location_id = any (public.staff_location_ids()))
$$;

create function public.staff_sees_reservation(p_reservation uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null
    or exists (
      select 1 from public.reservations r
      where r.id = p_reservation
        and (r.pickup_location_id = any (public.staff_location_ids()) or r.return_location_id = any (public.staff_location_ids()))
    )
$$;

create function public.staff_sees_customer(p_customer uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null
    or exists (select 1 from public.customers c where c.id = p_customer and c.location_id = any (public.staff_location_ids()))
    or exists (
      select 1 from public.reservations r
      where r.customer_id = p_customer
        and (r.pickup_location_id = any (public.staff_location_ids()) or r.return_location_id = any (public.staff_location_ids()))
    )
$$;

create function public.staff_sees_conversation(p_conversation uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null
    or exists (select 1 from public.conversations c where c.id = p_conversation and c.location_id = any (public.staff_location_ids()))
$$;

create function public.staff_sees_payment(p_payment uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null
    or exists (select 1 from public.payments p where p.id = p_payment and public.staff_sees_reservation(p.reservation_id))
$$;

create function public.staff_sees_inspection(p_inspection uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null
    or exists (select 1 from public.inspections i where i.id = p_inspection and public.staff_sees_reservation(i.reservation_id))
$$;

create function public.staff_sees_prep_task(p_task uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null
    or exists (select 1 from public.prep_tasks t where t.id = p_task and public.staff_sees_vehicle(t.vehicle_id))
$$;

create function public.staff_sees_message(p_message uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_location_ids() is null
    or exists (select 1 from public.messages m where m.id = p_message and public.staff_sees_conversation(m.conversation_id))
$$;

grant execute on function public.staff_location_ids(), public.is_hq_staff(), public.staff_sees_location(uuid), public.staff_sees_vehicle(uuid), public.staff_sees_reservation(uuid), public.staff_sees_customer(uuid), public.staff_sees_conversation(uuid), public.staff_sees_payment(uuid), public.staff_sees_inspection(uuid), public.staff_sees_prep_task(uuid), public.staff_sees_message(uuid) to authenticated, service_role;

alter table public.staff_locations enable row level security;
create policy staff_locations_staff_read on public.staff_locations for select to authenticated using ((select public.is_staff()));
create policy staff_locations_admin_write on public.staff_locations for all to authenticated using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
revoke all on public.staff_locations from anon;
grant all on public.staff_locations to service_role;

drop policy vehicles_staff_read on public.vehicles;
create policy vehicles_staff_read on public.vehicles for select to authenticated using ((select public.is_staff()) and public.staff_sees_location(location_id));

drop policy vehicle_blocks_staff_read on public.vehicle_blocks;
create policy vehicle_blocks_staff_read on public.vehicle_blocks for select to authenticated using ((select public.is_staff()) and public.staff_sees_vehicle(vehicle_id));

drop policy vehicle_allocations_staff_read on public.vehicle_allocations;
create policy vehicle_allocations_staff_read on public.vehicle_allocations for select to authenticated using ((select public.is_staff()) and public.staff_sees_vehicle(vehicle_id));

drop policy reservations_staff_read on public.reservations;
create policy reservations_staff_read on public.reservations for select to authenticated using ((select public.is_staff()) and (public.staff_sees_location(pickup_location_id) or public.staff_sees_location(return_location_id)));

drop policy reservation_line_items_staff_read on public.reservation_line_items;
create policy reservation_line_items_staff_read on public.reservation_line_items for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy customers_staff_read on public.customers;
create policy customers_staff_read on public.customers for select to authenticated using ((select public.is_staff()) and public.staff_sees_customer(id));

drop policy conversations_staff_read on public.conversations;
create policy conversations_staff_read on public.conversations for select to authenticated using ((select public.is_staff()) and public.staff_sees_location(location_id));

drop policy conversations_staff_update on public.conversations;
create policy conversations_staff_update on public.conversations for update to authenticated using ((select public.is_staff()) and public.staff_sees_location(location_id)) with check ((select public.is_staff()) and public.staff_sees_location(location_id));

drop policy messages_staff_read on public.messages;
create policy messages_staff_read on public.messages for select to authenticated using ((select public.is_staff()) and public.staff_sees_conversation(conversation_id));

drop policy message_attachments_staff_read on public.message_attachments;
create policy message_attachments_staff_read on public.message_attachments for select to authenticated using ((select public.is_staff()) and public.staff_sees_message(message_id));

drop policy agreements_staff_read on public.agreements;
create policy agreements_staff_read on public.agreements for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy payments_staff_read on public.payments;
create policy payments_staff_read on public.payments for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy refunds_staff_read on public.refunds;
create policy refunds_staff_read on public.refunds for select to authenticated using ((select public.is_staff()) and public.staff_sees_payment(payment_id));

drop policy inspections_staff_read on public.inspections;
create policy inspections_staff_read on public.inspections for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy inspection_photos_staff_read on public.inspection_photos;
create policy inspection_photos_staff_read on public.inspection_photos for select to authenticated using ((select public.is_staff()) and public.staff_sees_inspection(inspection_id));

drop policy change_requests_staff_read on public.change_requests;
create policy change_requests_staff_read on public.change_requests for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy ratings_staff_read on public.ratings;
create policy ratings_staff_read on public.ratings for select to authenticated using ((select public.is_staff()) and (case when reservation_id is not null then public.staff_sees_reservation(reservation_id) when conversation_id is not null then public.staff_sees_conversation(conversation_id) when customer_id is not null then public.staff_sees_customer(customer_id) else public.staff_location_ids() is null end));

drop policy trip_surveys_staff_read on public.trip_surveys;
create policy trip_surveys_staff_read on public.trip_surveys for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy media_staff_read on public.media;
create policy media_staff_read on public.media for select to authenticated using ((select public.is_staff()) and (public.staff_location_ids() is null or (reservation_id is not null and public.staff_sees_reservation(reservation_id)) or (vehicle_id is not null and public.staff_sees_vehicle(vehicle_id))));

drop policy prep_tasks_staff_read on public.prep_tasks;
create policy prep_tasks_staff_read on public.prep_tasks for select to authenticated using ((select public.is_staff()) and public.staff_sees_vehicle(vehicle_id));

drop policy prep_photos_staff_read on public.prep_photos;
create policy prep_photos_staff_read on public.prep_photos for select to authenticated using ((select public.is_staff()) and public.staff_sees_prep_task(task_id));

drop policy approvals_staff_read on public.approvals;
create policy approvals_staff_read on public.approvals for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy damage_claims_staff_read on public.damage_claims;
create policy damage_claims_staff_read on public.damage_claims for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy vehicle_service_logs_staff_read on public.vehicle_service_logs;
create policy vehicle_service_logs_staff_read on public.vehicle_service_logs for select to authenticated using ((select public.is_staff()) and public.staff_sees_vehicle(vehicle_id));

drop policy self_service_photos_staff_read on public.self_service_photos;
create policy self_service_photos_staff_read on public.self_service_photos for select to authenticated using ((select public.is_staff()) and public.staff_sees_reservation(reservation_id));

drop policy shift_notes_staff_read on public.shift_notes;
create policy shift_notes_staff_read on public.shift_notes for select to authenticated using ((select public.is_staff()) and (location_id is null or public.staff_sees_location(location_id)));

drop policy leads_staff_read on public.leads;
create policy leads_staff_read on public.leads for select to authenticated using ((select public.is_hq_staff()));

drop policy leads_staff_update on public.leads;
create policy leads_staff_update on public.leads for update to authenticated using ((select public.is_hq_staff())) with check ((select public.is_hq_staff()));

drop policy audit_events_staff_read on public.audit_events;
create policy audit_events_staff_read on public.audit_events for select to authenticated using ((select public.is_hq_staff()));

drop policy blog_posts_staff on public.blog_posts;
create policy blog_posts_staff on public.blog_posts for all to authenticated using ((select public.is_hq_staff())) with check ((select public.is_hq_staff()));

drop policy blog_post_views_staff_read on public.blog_post_views;
create policy blog_post_views_staff_read on public.blog_post_views for select to authenticated using ((select public.is_hq_staff()));
