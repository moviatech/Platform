alter table public.refunds add column offline_method text check (offline_method in ('TRANSFER', 'ZELLE', 'CASH', 'OTHER'));

create function public.record_offline_refund(p_payment_id uuid, p_amount_cents integer, p_method text, p_reason text, p_created_by uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_refunded integer;
  v_refund uuid;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;
  if v_payment.offline_method is null or v_payment.stripe_payment_intent_id is not null or v_payment.status not in ('SUCCEEDED', 'PARTIALLY_REFUNDED') then
    raise exception 'not_refundable';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > v_payment.amount_captured_cents - v_payment.amount_refunded_cents then
    raise exception 'invalid_amount';
  end if;

  v_refunded := v_payment.amount_refunded_cents + p_amount_cents;

  insert into public.refunds (payment_id, amount_cents, reason, status, offline_method, created_by)
  values (p_payment_id, p_amount_cents, nullif(p_reason, ''), 'SUCCEEDED', p_method, p_created_by)
  returning id into v_refund;

  update public.payments
  set amount_refunded_cents = v_refunded,
      status = (case when v_refunded >= v_payment.amount_captured_cents then 'REFUNDED' else 'PARTIALLY_REFUNDED' end)::public.payment_status
  where id = p_payment_id;

  perform public.sync_reservation_payment_state(v_payment.reservation_id);
  return v_refund;
end;
$$;

revoke all on function public.record_offline_refund(uuid, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_offline_refund(uuid, integer, text, text, uuid) to service_role;
