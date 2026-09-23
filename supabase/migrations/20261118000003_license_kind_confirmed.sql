alter table public.customers add column license_kind_confirmed boolean not null default false;

update public.customers
set license_kind = case when upper(license_state) = 'US' then 'US' when license_kind = 'TRANSLATED' then 'TRANSLATED' else 'INTERNATIONAL' end,
    license_kind_confirmed = true
where identity_status = 'VERIFIED' and coalesce(license_state, '') <> '';

update public.reservations r
set verification_state = 'PENDING'
from public.customers c
where c.id = r.customer_id
  and r.status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED')
  and c.license_kind <> 'US'
  and r.verification_state = 'VERIFIED'
  and r.license_onsite_at is null;

update public.reservations r
set insurance_state = case when r.insurance_proof_path is not null then 'UPLOADED' else 'PENDING' end
from public.customers c
where c.id = r.customer_id
  and r.status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED')
  and r.protection = 'none'
  and c.license_kind <> 'US'
  and r.insurance_state = 'NOT_REQUIRED';

update public.reservations r
set insurance_state = 'NOT_REQUIRED', insurance_verified_by = null, insurance_verified_at = null
from public.customers c
where c.id = r.customer_id
  and r.status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED')
  and (r.protection <> 'none' or c.license_kind = 'US')
  and r.insurance_state <> 'NOT_REQUIRED';
