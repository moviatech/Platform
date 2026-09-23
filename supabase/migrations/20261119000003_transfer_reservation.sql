create function public.transfer_reservation_customer(p_reservation_id uuid, p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old uuid;
begin
  select customer_id into v_old from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_old = p_customer_id then
    raise exception 'same_customer';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer_not_found';
  end if;
  if exists (select 1 from public.customers where id = p_customer_id and dnr_flag) then
    raise exception 'customer_blocked';
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

  return v_old;
end;
$function$;

revoke all on function public.transfer_reservation_customer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_reservation_customer(uuid, uuid) to service_role;
