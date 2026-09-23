create function public.revert_reservation_status(p_reservation_id uuid, p_previous public.reservation_status) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
  v_vehicle uuid;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found';
  end if;
  if p_previous not in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE') then
    raise exception 'invalid_revert';
  end if;

  if v_res.status in ('CANCELLED', 'NO_SHOW', 'EXPIRED') then
    perform pg_advisory_xact_lock(hashtext(v_res.class_id::text));
    select id into v_vehicle from public.available_vehicles(v_res.class_id, v_res.pickup_at, v_res.return_at) limit 1;
    if v_vehicle is null then
      raise exception 'no_vehicle_available';
    end if;
    insert into public.vehicle_allocations (vehicle_id, period, reservation_id)
    values (v_vehicle, tstzrange(v_res.pickup_at, v_res.blocked_until), p_reservation_id);
    update public.reservations
    set status = p_previous,
        assigned_vehicle_id = v_vehicle,
        cancelled_at = null,
        cancel_reason = null,
        actual_pickup_at = case when p_previous = 'ACTIVE' then coalesce(actual_pickup_at, now()) else null end,
        expires_at = case when p_previous in ('REQUESTED', 'PENDING_PAYMENT') then now() + interval '24 hours' else null end
    where id = p_reservation_id;
  elsif v_res.status = 'COMPLETED' and p_previous = 'ACTIVE' then
    update public.vehicle_allocations set period = tstzrange(lower(period), v_res.blocked_until) where reservation_id = p_reservation_id;
    update public.reservations set status = 'ACTIVE', actual_return_at = null, completed_at = null where id = p_reservation_id;
  elsif v_res.status = 'ACTIVE' and p_previous = 'CONFIRMED' then
    update public.reservations set status = 'CONFIRMED', actual_pickup_at = null where id = p_reservation_id;
  elsif v_res.status = 'CONFIRMED' and p_previous in ('REQUESTED', 'PENDING_PAYMENT') then
    update public.reservations set status = p_previous, expires_at = now() + interval '24 hours' where id = p_reservation_id;
  else
    raise exception 'invalid_revert';
  end if;
end;
$$;

revoke all on function public.revert_reservation_status(uuid, public.reservation_status) from public, anon, authenticated;
grant execute on function public.revert_reservation_status(uuid, public.reservation_status) to service_role;
