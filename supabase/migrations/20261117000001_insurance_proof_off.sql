update public.reservations
set insurance_state = 'NOT_REQUIRED'
where insurance_state in ('PENDING', 'UPLOADED')
  and status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED');
