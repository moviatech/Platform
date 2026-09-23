create or replace function public.reschedule_reservation(p_reservation_id uuid, p_class_id uuid, p_pickup_at timestamptz, p_return_at timestamptz) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
  v_class public.vehicle_classes;
  v_blocked timestamptz;
  v_vehicle_id uuid;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_res.status = 'ACTIVE' then
    if p_class_id <> v_res.class_id or p_pickup_at <> v_res.pickup_at or p_return_at < v_res.return_at then
      raise exception 'reservation_closed';
    end if;
  elsif v_res.status not in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED') then
    raise exception 'reservation_closed';
  end if;
  if p_return_at <= p_pickup_at then
    raise exception 'invalid_period';
  end if;
  select * into v_class from public.vehicle_classes where id = p_class_id and active;
  if not found then
    raise exception 'class_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_class.id::text));
  v_blocked := p_return_at + make_interval(hours => v_class.buffer_hours);

  if v_res.assigned_vehicle_id is not null and v_res.class_id = p_class_id then
    begin
      update public.vehicle_allocations
      set period = tstzrange(p_pickup_at, v_blocked)
      where reservation_id = p_reservation_id;
      v_vehicle_id := v_res.assigned_vehicle_id;
    exception when exclusion_violation then
      v_vehicle_id := null;
    end;
  end if;

  if v_vehicle_id is null and v_res.status = 'ACTIVE' then
    raise exception 'no_vehicle_available';
  end if;
  if v_vehicle_id is null then
    select id into v_vehicle_id from public.available_vehicles(p_class_id, p_pickup_at, p_return_at, p_reservation_id) limit 1;
    if v_vehicle_id is null then
      raise exception 'no_vehicle_available';
    end if;
    delete from public.vehicle_allocations where reservation_id = p_reservation_id;
    insert into public.vehicle_allocations (vehicle_id, period, reservation_id)
    values (v_vehicle_id, tstzrange(p_pickup_at, v_blocked), p_reservation_id);
  end if;

  update public.reservations
  set class_id = p_class_id,
      assigned_vehicle_id = v_vehicle_id,
      pickup_at = p_pickup_at,
      return_at = p_return_at,
      blocked_until = v_blocked
  where id = p_reservation_id;

  return v_vehicle_id;
end;
$$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'movia-tick',
  '7 * * * *',
  $job$
  select net.http_post(
    url := 'https://api.moviatech.ai/internal/tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-internal-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'internal_tick_key' limit 1), '')
    )
  );
  $job$
);
