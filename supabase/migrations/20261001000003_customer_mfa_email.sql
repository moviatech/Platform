alter table public.customers
  drop column if exists mfa_phone,
  add column mfa_code_hash text,
  add column mfa_code_expires_at timestamptz;
