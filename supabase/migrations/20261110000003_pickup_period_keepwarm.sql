create or replace function public.set_reservation_status(p_reservation_id uuid, p_status public.reservation_status, p_reason text default null) returns public.reservation_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
  v_buffer integer;
  v_allowed boolean;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found';
  end if;

  v_allowed := case v_res.status
    when 'REQUESTED' then p_status in ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED')
    when 'PENDING_PAYMENT' then p_status in ('CONFIRMED', 'CANCELLED', 'EXPIRED')
    when 'CONFIRMED' then p_status in ('ACTIVE', 'CANCELLED', 'NO_SHOW')
    when 'ACTIVE' then p_status in ('COMPLETED')
    else false
  end;
  if not v_allowed then
    raise exception 'invalid_transition';
  end if;

  if p_status = 'CONFIRMED' then
    update public.reservations set status = p_status, expires_at = null where id = p_reservation_id;
  elsif p_status = 'ACTIVE' then
    if v_res.assigned_vehicle_id is null then
      raise exception 'vehicle_required';
    end if;
    begin
      update public.vehicle_allocations
      set period = tstzrange(now(), greatest(upper(period), now() + interval '1 minute'))
      where reservation_id = p_reservation_id and lower(period) > now();
    exception when exclusion_violation then
      raise exception 'vehicle_busy';
    end;
    update public.reservations set status = p_status, actual_pickup_at = coalesce(actual_pickup_at, now()) where id = p_reservation_id;
  elsif p_status = 'COMPLETED' then
    select buffer_hours into v_buffer from public.vehicle_classes where id = v_res.class_id;
    update public.reservations
    set status = p_status, actual_return_at = coalesce(actual_return_at, now()), completed_at = now()
    where id = p_reservation_id;
    begin
      update public.vehicle_allocations
      set period = tstzrange(least(lower(period), now() - interval '1 minute'), now() + make_interval(hours => v_buffer))
      where reservation_id = p_reservation_id
        and now() + make_interval(hours => v_buffer) < upper(period);
    exception when exclusion_violation then
      update public.vehicle_allocations
      set period = tstzrange(lower(period), greatest(lower(period) + interval '1 minute', now() + make_interval(hours => v_buffer)))
      where reservation_id = p_reservation_id
        and now() + make_interval(hours => v_buffer) < upper(period);
    end;
  else
    update public.reservations
    set status = p_status, cancelled_at = now(), cancel_reason = p_reason, assigned_vehicle_id = null
    where id = p_reservation_id;
    delete from public.vehicle_allocations where reservation_id = p_reservation_id;
  end if;

  return p_status;
end;
$$;

select cron.schedule(
  'movia-warm',
  '*/5 * * * *',
  $job$
  select net.http_get(url := 'https://api.moviatech.ai/public/status');
  $job$
);
