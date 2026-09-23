create table public.expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  storage_path text not null unique,
  content_type text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index expense_receipts_expense_idx on public.expense_receipts (expense_id, created_at);

insert into storage.buckets (id, name, public, file_size_limit)
values ('expense-receipts', 'expense-receipts', false, 10485760)
on conflict (id) do nothing;

create table public.stripe_balance_transactions (
  id text primary key,
  livemode boolean not null,
  type text not null,
  category text not null,
  amount_cents integer not null,
  fee_cents integer not null default 0,
  net_cents integer not null,
  currency text not null default 'usd',
  status text not null,
  description text,
  source_id text,
  payment_intent_id text,
  payout_id text,
  created_at timestamptz not null,
  available_on timestamptz,
  synced_at timestamptz not null default now()
);

create index stripe_balance_transactions_created_idx on public.stripe_balance_transactions (livemode, created_at desc);
create index stripe_balance_transactions_intent_idx on public.stripe_balance_transactions (payment_intent_id) where payment_intent_id is not null;
create index stripe_balance_transactions_payout_idx on public.stripe_balance_transactions (payout_id) where payout_id is not null;

create table public.stripe_payouts (
  id text primary key,
  livemode boolean not null,
  amount_cents integer not null,
  currency text not null default 'usd',
  status text not null,
  method text,
  automatic boolean not null default true,
  arrival_date timestamptz,
  created_at timestamptz not null,
  linked_at timestamptz,
  synced_at timestamptz not null default now()
);

create index stripe_payouts_arrival_idx on public.stripe_payouts (livemode, arrival_date desc);

do $$
declare
  t text;
begin
  foreach t in array array['expense_receipts', 'stripe_balance_transactions', 'stripe_payouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;
