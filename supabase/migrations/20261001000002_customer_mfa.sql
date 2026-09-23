alter table public.customers
  add column mfa_phone text,
  add column mfa_enabled boolean not null default false;
