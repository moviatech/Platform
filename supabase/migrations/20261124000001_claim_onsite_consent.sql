alter table public.damage_claims
  add column consent_method text check (consent_method in ('PORTAL', 'ONSITE')),
  add column consent_name text,
  add column consent_signature text;
