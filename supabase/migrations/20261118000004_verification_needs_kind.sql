update public.reservations r
set verification_state = 'PENDING'
from public.customers c
where c.id = r.customer_id
  and r.status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED')
  and r.verification_state = 'VERIFIED'
  and not c.license_kind_confirmed;
