create table public.prep_tasks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete set null,
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'DONE')),
  checklist jsonb not null default '{}'::jsonb,
  notes text,
  issue text,
  issue_open boolean not null default false,
  assigned_to uuid references public.staff_members (user_id) on delete set null,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.staff_members (user_id) on delete set null,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index prep_tasks_vehicle_idx on public.prep_tasks (vehicle_id, status);
create index prep_tasks_open_idx on public.prep_tasks (due_at) where status <> 'DONE';

create table public.prep_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.prep_tasks (id) on delete cascade,
  phase text not null check (phase in ('BEFORE', 'AFTER')),
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index prep_photos_task_idx on public.prep_photos (task_id);

alter table public.prep_tasks enable row level security;
alter table public.prep_photos enable row level security;
revoke all on public.prep_tasks, public.prep_photos from anon;
grant select on public.prep_tasks, public.prep_photos to authenticated, service_role;
grant insert, update, delete on public.prep_tasks, public.prep_photos to service_role;

create policy prep_tasks_staff_read on public.prep_tasks
for select to authenticated using ((select public.is_staff()));

create policy prep_photos_staff_read on public.prep_photos
for select to authenticated using ((select public.is_staff()));

alter table public.media add constraint media_prep_task_fk foreign key (prep_task_id) references public.prep_tasks (id) on delete set null;
