create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  kind text not null check (kind in ('schedule', 'extend', 'driver', 'childSeat', 'pickupReturn', 'accessibility', 'special', 'issue', 'other')),
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'IN_REVIEW', 'NEED_INFO', 'APPROVED', 'DECLINED', 'CLOSED')),
  payload jsonb not null default '{}'::jsonb,
  staff_note text,
  fee_cents integer,
  resolved_by uuid references public.staff_members (user_id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index change_requests_reservation_idx on public.change_requests (reservation_id, status);
create index change_requests_customer_idx on public.change_requests (customer_id, created_at desc);

create trigger change_requests_touch before update on public.change_requests for each row execute function public.touch_updated_at();

alter table public.change_requests enable row level security;
revoke all on public.change_requests from anon;

create policy change_requests_staff_read on public.change_requests
for select to authenticated using ((select public.is_staff()));

create policy change_requests_customer_read on public.change_requests
for select to authenticated using (customer_id = (select public.current_customer_id()));

alter table public.conversations add column customer_read_at timestamptz;

create policy message_attachments_customer_read on public.message_attachments
for select to authenticated using (
  exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = message_id and m.direction <> 'INTERNAL' and c.customer_id = (select public.current_customer_id())
  )
);
