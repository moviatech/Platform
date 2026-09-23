create table public.fin_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  tax_class text not null default 'UNKNOWN' check (tax_class in ('INDIVIDUAL', 'PARTNERSHIP', 'LLC', 'C_CORP', 'S_CORP', 'OTHER', 'UNKNOWN')),
  needs_1099 boolean not null default false,
  w9_received_on date,
  note text check (char_length(note) <= 1000),
  active boolean not null default true,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index fin_vendors_name_idx on public.fin_vendors (lower(btrim(name)));

alter table public.expenses
  add column vendor_id uuid references public.fin_vendors (id) on delete restrict;

create index expenses_vendor_idx on public.expenses (vendor_id, spent_on) where vendor_id is not null;

alter table public.fin_vendors enable row level security;
revoke all on table public.fin_vendors from public, anon, authenticated, service_role;
grant select, insert, update on table public.fin_vendors to service_role;
