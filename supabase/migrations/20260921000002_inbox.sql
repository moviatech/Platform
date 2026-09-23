create type public.conversation_status as enum ('OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'SPAM');
create type public.message_direction as enum ('INBOUND', 'OUTBOUND', 'INTERNAL');
create type public.message_channel as enum ('EMAIL', 'WEB_FORM', 'NOTE');
create type public.delivery_status as enum ('RECEIVED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
  mailbox text not null default 'contact' check (mailbox in ('contact', 'support')),
  subject text,
  customer_email text not null,
  customer_name text,
  locale text,
  status public.conversation_status not null default 'OPEN',
  unread boolean not null default true,
  assigned_to uuid references public.staff_members (user_id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  last_direction public.message_direction,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_status_idx on public.conversations (status, last_message_at desc);
create index conversations_email_idx on public.conversations (lower(customer_email));
create index conversations_lead_idx on public.conversations (lead_id);

create trigger conversations_touch before update on public.conversations
for each row execute function public.touch_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete restrict,
  direction public.message_direction not null,
  channel public.message_channel not null,
  from_email text,
  from_name text,
  to_email text,
  subject text,
  body_text text not null default '',
  body_html text,
  message_id_header text,
  in_reply_to text,
  references_header text,
  provider_message_id text,
  delivery_status public.delivery_status not null,
  delivery_error text,
  sent_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index messages_message_id_idx on public.messages (message_id_header) where message_id_header is not null;
create index messages_provider_idx on public.messages (provider_message_id) where provider_message_id is not null;
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete restrict,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

create index message_attachments_message_idx on public.message_attachments (message_id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;

create policy conversations_staff_read on public.conversations
for select to authenticated
using ((select public.is_staff()));

create policy conversations_staff_update on public.conversations
for update to authenticated
using ((select public.is_staff()))
with check ((select public.is_staff()));

create policy messages_staff_read on public.messages
for select to authenticated
using ((select public.is_staff()));

create policy message_attachments_staff_read on public.message_attachments
for select to authenticated
using ((select public.is_staff()));

revoke all on public.conversations, public.messages, public.message_attachments from anon;

insert into storage.buckets (id, name, public, file_size_limit)
values ('message-attachments', 'message-attachments', false, 10485760)
on conflict (id) do nothing;
