create or replace function public.claim_coupon(p_coupon_id uuid, p_customer_id uuid, p_ignore_reservation uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon public.coupons;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_count integer;
begin
  perform public.expire_stale_reservations();
  select * into v_coupon from public.coupons where id = p_coupon_id for update;
  if not found or not v_coupon.active then
    raise exception 'coupon_invalid';
  end if;
  if v_coupon.valid_from is not null and v_today < v_coupon.valid_from then
    raise exception 'coupon_invalid';
  end if;
  if v_coupon.valid_to is not null and v_today > v_coupon.valid_to then
    raise exception 'coupon_expired';
  end if;
  if v_coupon.max_redemptions is not null then
    select count(*) into v_count from public.reservations
    where coupon_id = v_coupon.id and status not in ('CANCELLED', 'EXPIRED')
      and (p_ignore_reservation is null or id <> p_ignore_reservation);
    if v_count >= v_coupon.max_redemptions then
      raise exception 'coupon_exhausted';
    end if;
  end if;
  if p_customer_id is not null and v_coupon.per_customer_limit is not null then
    select count(*) into v_count from public.reservations
    where coupon_id = v_coupon.id and customer_id = p_customer_id and status not in ('CANCELLED', 'EXPIRED')
      and (p_ignore_reservation is null or id <> p_ignore_reservation);
    if v_count >= v_coupon.per_customer_limit then
      raise exception 'coupon_customer_limit';
    end if;
  end if;
  if p_customer_id is not null and v_coupon.first_order_only and exists (
    select 1 from public.reservations
    where customer_id = p_customer_id and status not in ('CANCELLED', 'EXPIRED')
      and (p_ignore_reservation is null or id <> p_ignore_reservation)
  ) then
    raise exception 'coupon_first_order';
  end if;
end;
$$;

create function public.attach_coupon(p_reservation_id uuid, p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
begin
  select customer_id into v_customer_id from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'coupon_invalid';
  end if;
  perform public.claim_coupon(p_coupon_id, v_customer_id, p_reservation_id);
  update public.reservations set coupon_id = p_coupon_id where id = p_reservation_id;
end;
$$;

revoke all on function public.attach_coupon(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_coupon(uuid, uuid) to service_role;
