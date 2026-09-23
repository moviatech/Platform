create type public.investor_status as enum ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'CLOSED');

alter table public.audit_events drop constraint audit_events_actor_type_check;
alter table public.audit_events add constraint audit_events_actor_type_check check (actor_type in ('STAFF', 'CUSTOMER', 'INVESTOR', 'SYSTEM', 'API'));

create function public.generate_investor_number() returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
begin
  loop
    candidate := 'IV-';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.investors where investor_number = candidate);
  end loop;
  return candidate;
end;
$$;

create table public.investors (
  id uuid primary key default gen_random_uuid(),
  investor_number text not null unique,
  auth_user_id uuid unique references auth.users (id) on delete restrict,
  legal_name text not null,
  email text not null,
  phone text not null,
  phone_normalized text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  preferred_language text not null default 'zh',
  status public.investor_status not null default 'PENDING',
  notes text,
  mfa_code_hash text,
  mfa_code_expires_at timestamptz,
  reviewed_by uuid references public.staff_members (user_id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.investors alter column investor_number set default public.generate_investor_number();

create unique index investors_email_idx on public.investors (lower(email));
create unique index investors_phone_idx on public.investors (phone_normalized) where phone_normalized is not null;
create index investors_status_idx on public.investors (status, created_at desc);

create trigger investors_touch before update on public.investors
for each row execute function public.touch_updated_at();

create table public.investor_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete restrict,
  bank_name text not null,
  account_type text not null check (account_type in ('CHECKING', 'SAVINGS')),
  holder_name text not null,
  last4 text not null,
  encrypted_payload text not null,
  usable_after timestamptz not null default now() + interval '48 hours',
  removed_at timestamptz,
  created_at timestamptz not null default now()
);

create index investor_bank_accounts_investor_idx on public.investor_bank_accounts (investor_id, created_at desc);

create table public.investor_documents (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors (id) on delete restrict,
  allocation_id uuid,
  kind text not null check (kind in ('AGREEMENT', 'VEHICLE', 'TAX', 'STATEMENT', 'OTHER')),
  title text not null,
  storage_key text not null unique,
  content_type text not null,
  size_bytes bigint not null default 0,
  signed_on date,
  uploaded_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index investor_documents_investor_idx on public.investor_documents (investor_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit)
values ('investor-documents', 'investor-documents', false, 20971520)
on conflict (id) do nothing;

alter table public.notifications drop constraint notifications_audience_check;
alter table public.notifications add constraint notifications_audience_check check (audience in ('STAFF', 'CUSTOMER', 'INVESTOR'));
alter table public.notifications add column investor_id uuid references public.investors (id) on delete cascade;
create index notifications_investor_idx on public.notifications (investor_id, created_at desc) where investor_id is not null;

alter table public.conversations add column investor_id uuid references public.investors (id) on delete set null;
create index conversations_investor_idx on public.conversations (investor_id, last_message_at desc) where investor_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['investors', 'investor_bank_accounts', 'investor_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

revoke all on function public.generate_investor_number() from public, anon, authenticated;
grant execute on function public.generate_investor_number() to service_role;
