create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  audience text not null check (audience in ('customer', 'staff', 'investor')),
  recipients text not null,
  subject text not null,
  body_text text not null,
  body_html text,
  attachments text[] not null default '{}',
  sent boolean not null,
  message_id text,
  reservation_id uuid references public.reservations (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null
);

create index email_log_created_idx on public.email_log (audience, created_at desc);
create index email_log_reservation_idx on public.email_log (reservation_id) where reservation_id is not null;

alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;
grant select, insert, update, delete on public.email_log to service_role;
