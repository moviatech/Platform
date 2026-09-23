drop function public.transfer_reservation_customer(uuid, uuid);

create function public.transfer_reservation_customer(p_reservation_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old uuid;
  v_from public.customers;
  v_to public.customers;
  v_card text := 'none';
begin
  select customer_id into v_old from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_old = p_customer_id then
    raise exception 'same_customer';
  end if;

  perform 1 from public.customers where id in (v_old, p_customer_id) order by id for update;
  select * into v_to from public.customers where id = p_customer_id;
  if not found then
    raise exception 'customer_not_found';
  end if;
  if v_to.dnr_flag then
    raise exception 'customer_blocked';
  end if;
  select * into v_from from public.customers where id = v_old;

  if v_from.stripe_payment_method_id is not null then
    if v_from.auth_user_id is null
      and v_from.stripe_customer_id is not null
      and v_to.stripe_customer_id is null
      and v_to.stripe_payment_method_id is null
      and not exists (select 1 from public.reservations where customer_id = v_old and id <> p_reservation_id)
    then
      update public.customers
      set stripe_customer_id = null, stripe_payment_method_id = null, stripe_card_brand = null, stripe_card_last4 = null
      where id = v_old;
      update public.customers
      set stripe_customer_id = v_from.stripe_customer_id,
        stripe_payment_method_id = v_from.stripe_payment_method_id,
        stripe_card_brand = v_from.stripe_card_brand,
        stripe_card_last4 = v_from.stripe_card_last4
      where id = p_customer_id;
      v_card := 'moved';
    else
      v_card := 'kept';
    end if;
  end if;

  update public.reservations set customer_id = p_customer_id where id = p_reservation_id;
  update public.payments set customer_id = p_customer_id where reservation_id = p_reservation_id;
  update public.agreements set customer_id = p_customer_id where reservation_id = p_reservation_id;
  update public.damage_claims set customer_id = p_customer_id where reservation_id = p_reservation_id;
  update public.change_requests set customer_id = p_customer_id where reservation_id = p_reservation_id;
  update public.ratings set customer_id = p_customer_id where reservation_id = p_reservation_id and customer_id = v_old;
  update public.trip_surveys set customer_id = p_customer_id where reservation_id = p_reservation_id and customer_id = v_old;
  update public.notifications set customer_id = p_customer_id where reservation_id = p_reservation_id and customer_id = v_old;
  update public.conversations set customer_id = p_customer_id where reservation_id = p_reservation_id and customer_id = v_old;

  return jsonb_build_object('previous', v_old, 'card', v_card, 'stripe_customer', case when v_card = 'moved' then v_from.stripe_customer_id end);
end;
$function$;

revoke all on function public.transfer_reservation_customer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_reservation_customer(uuid, uuid) to service_role;
