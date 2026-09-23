alter table public.customers
  add column stripe_card_brand text,
  add column stripe_card_last4 text;

alter table public.agreements
  add column elections jsonb not null default '{}'::jsonb;

create table public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.staff_members (user_id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
revoke all on public.settings from anon;

create policy settings_staff_read on public.settings
for select to authenticated using ((select public.is_staff()));

insert into public.settings (key, value) values
  ('business', '{"legalName":"Movia Technologies, Inc.","tradeName":"Movia Technologies","address":"780 Roosevelt, #127, Irvine, CA 92620","phone":"+1 (626) 390-4721","email":"contact@moviatech.ai","emergencyPhone":"","serviceHours":"7 a.m.–9 p.m. Pacific"}'::jsonb),
  ('insurance', '{"insurer":"","policyReference":"","effectiveDates":"","biLimitPerPerson":"","biLimitPerOccurrence":"","propertyDamageLimit":"","deductible":"","driverCategories":"","territory":"","rentalEligibility":"","supplementalProducts":"None","claimsContact":"","incidentPhone":"","ownerRelationship":""}'::jsonb)
on conflict (key) do nothing;
