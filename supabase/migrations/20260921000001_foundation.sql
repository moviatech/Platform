create extension if not exists btree_gist;

create type public.staff_role as enum ('SUPER_ADMIN', 'STAFF');
create type public.lead_kind as enum ('CONTACT', 'BOOKING_REQUEST', 'ASSISTANT');
create type public.lead_status as enum ('NEW', 'IN_PROGRESS', 'CONVERTED', 'CLOSED', 'SPAM');

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.staff_members (
  user_id uuid primary key references auth.users (id) on delete restrict,
  email text not null unique,
  display_name text not null,
  job_title text,
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_roles (
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  role public.staff_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create trigger staff_members_touch before update on public.staff_members
for each row execute function public.touch_updated_at();

create function public.is_staff() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    and exists (
      select 1 from public.staff_members
      where user_id = (select auth.uid()) and active
    );
$$;

create function public.is_super_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff()
    and exists (
      select 1 from public.staff_roles
      where user_id = (select auth.uid()) and role = 'SUPER_ADMIN'
    );
$$;

create function public.guard_last_super_admin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining integer;
begin
  select count(*) into remaining
  from public.staff_roles r
  join public.staff_members m on m.user_id = r.user_id
  where r.role = 'SUPER_ADMIN' and m.active;
  if remaining = 0 then
    raise exception 'last_super_admin_protected';
  end if;
  return null;
end;
$$;

create constraint trigger staff_roles_guard
after delete or update on public.staff_roles
deferrable initially deferred
for each row execute function public.guard_last_super_admin();

create constraint trigger staff_members_guard
after delete or update of active on public.staff_members
deferrable initially deferred
for each row execute function public.guard_last_super_admin();

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_type text not null check (actor_type in ('STAFF', 'CUSTOMER', 'SYSTEM', 'API')),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);
create index audit_events_actor_idx on public.audit_events (actor_user_id, created_at desc);
create index audit_events_created_idx on public.audit_events (created_at desc);

create function public.block_audit_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events_append_only';
end;
$$;

create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function public.block_audit_mutation();

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  kind public.lead_kind not null,
  status public.lead_status not null default 'NEW',
  reference text unique,
  name text,
  email text,
  phone text,
  wechat text,
  locale text,
  source_url text,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  assigned_to uuid references public.staff_members (user_id) on delete set null,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_status_idx on public.leads (status, created_at desc);
create index leads_kind_idx on public.leads (kind, created_at desc);

create trigger leads_touch before update on public.leads
for each row execute function public.touch_updated_at();

alter table public.staff_members enable row level security;
alter table public.staff_roles enable row level security;
alter table public.audit_events enable row level security;
alter table public.leads enable row level security;

create policy staff_members_self on public.staff_members
for select to authenticated
using (user_id = (select auth.uid()));

create policy staff_members_staff_read on public.staff_members
for select to authenticated
using ((select public.is_staff()));

create policy staff_members_admin_write on public.staff_members
for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy staff_roles_self on public.staff_roles
for select to authenticated
using (user_id = (select auth.uid()));

create policy staff_roles_staff_read on public.staff_roles
for select to authenticated
using ((select public.is_staff()));

create policy staff_roles_admin_write on public.staff_roles
for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy audit_events_staff_read on public.audit_events
for select to authenticated
using ((select public.is_staff()));

create policy leads_staff_read on public.leads
for select to authenticated
using ((select public.is_staff()));

create policy leads_staff_update on public.leads
for update to authenticated
using ((select public.is_staff()))
with check ((select public.is_staff()));

revoke all on public.staff_members, public.staff_roles, public.audit_events, public.leads from anon;
