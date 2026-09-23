insert into public.locations (code, name, name_zh, address, timezone, tax_rate_bps)
values
  ('SMR', 'San Marino', '圣马力诺门店', null, 'America/Los_Angeles', 1025),
  ('SJO', 'San Jose', '圣何塞门店', null, 'America/Los_Angeles', 938)
on conflict (code) do nothing;

drop function public.available_vehicles(uuid, timestamptz, timestamptz, uuid);

create function public.available_vehicles(p_class_id uuid, p_pickup_at timestamptz, p_return_at timestamptz, p_ignore_reservation uuid default null, p_location_id uuid default null)
returns setof public.vehicles
language sql
stable
security definer
set search_path = ''
as $$
  select v.*
  from public.vehicles v
  join public.vehicle_classes c on c.id = v.class_id
  where v.class_id = p_class_id
    and v.condition = 'IN_SERVICE'
    and (p_location_id is null or v.location_id = p_location_id)
    and not exists (
      select 1 from public.vehicle_allocations a
      left join public.reservations r on r.id = a.reservation_id
      where a.vehicle_id = v.id
        and a.period && tstzrange(p_pickup_at, p_return_at + make_interval(hours => c.buffer_hours))
        and (p_ignore_reservation is null or a.reservation_id is distinct from p_ignore_reservation)
        and not (r.id is not null and r.status in ('REQUESTED', 'PENDING_PAYMENT') and r.expires_at is not null and r.expires_at < now())
    )
    and not exists (
      select 1 from public.reservations o
      where o.assigned_vehicle_id = v.id and o.status = 'ACTIVE' and o.return_at < now()
        and (p_ignore_reservation is null or o.id <> p_ignore_reservation)
    )
  order by (
    select max(upper(a.period)) from public.vehicle_allocations a
    where a.vehicle_id = v.id and upper(a.period) <= p_pickup_at
  ) desc nulls last, v.fleet_number;
$$;

revoke all on function public.available_vehicles(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.available_vehicles(uuid, timestamptz, timestamptz, uuid, uuid) to service_role;

create or replace function public.create_reservation(payload jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.vehicle_classes;
  v_vehicle_id uuid;
  v_customer_id uuid;
  v_reservation_id uuid;
  v_number text;
  v_pickup timestamptz := (payload ->> 'pickup_at')::timestamptz;
  v_return timestamptz := (payload ->> 'return_at')::timestamptz;
  v_blocked timestamptz;
  v_customer jsonb := payload -> 'customer';
  v_email text := nullif(lower(trim(v_customer ->> 'email')), '');
  v_item jsonb;
  v_index integer := 0;
begin
  select * into v_class from public.vehicle_classes where id = (payload ->> 'class_id')::uuid and active;
  if not found then
    raise exception 'class_not_found';
  end if;
  if v_return <= v_pickup then
    raise exception 'invalid_period';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_class.id::text));
  perform public.expire_stale_reservations();

  v_blocked := v_return + make_interval(hours => v_class.buffer_hours);

  if payload ? 'vehicle_id' and payload ->> 'vehicle_id' is not null then
    select id into v_vehicle_id from public.available_vehicles(v_class.id, v_pickup, v_return, null, (payload ->> 'location_id')::uuid)
    where id = (payload ->> 'vehicle_id')::uuid;
  else
    select id into v_vehicle_id from public.available_vehicles(v_class.id, v_pickup, v_return, null, (payload ->> 'location_id')::uuid) limit 1;
  end if;
  if v_vehicle_id is null then
    raise exception 'no_vehicle_available';
  end if;

  if payload ? 'customer_id' and payload ->> 'customer_id' is not null then
    v_customer_id := (payload ->> 'customer_id')::uuid;
  end if;
  if v_customer_id is null and v_email is not null then
    select id into v_customer_id from public.customers where lower(email) = v_email;
  end if;

  if v_customer_id is null then
    insert into public.customers (full_name, email, phone, wechat, preferred_language)
    values (
      coalesce(nullif(trim(v_customer ->> 'full_name'), ''), 'Guest'),
      v_email,
      nullif(trim(v_customer ->> 'phone'), ''),
      nullif(trim(v_customer ->> 'wechat'), ''),
      coalesce(nullif(v_customer ->> 'preferred_language', ''), 'en')
    )
    returning id into v_customer_id;
  else
    if exists (select 1 from public.customers where id = v_customer_id and dnr_flag) then
      raise exception 'customer_blocked';
    end if;
    update public.customers set
      email = coalesce(email, v_email),
      phone = coalesce(phone, nullif(trim(v_customer ->> 'phone'), '')),
      wechat = coalesce(wechat, nullif(trim(v_customer ->> 'wechat'), ''))
    where id = v_customer_id;
  end if;

  v_number := public.generate_reservation_number();

  insert into public.reservations (
    number, customer_id, class_id, assigned_vehicle_id, pickup_location_id, return_location_id,
    pickup_at, return_at, blocked_until, status, rate_plan, pickup_method, delivery_address,
    protection, add_ons, driver_age_band, pricing_config_id, quote_snapshot, policy_snapshot,
    rental_days, subtotal_cents, discount_cents, tax_cents, total_cents, security_hold_cents,
    booking_source, lead_id, expires_at, customer_notes, internal_notes, created_by
  ) values (
    v_number, v_customer_id, v_class.id, v_vehicle_id,
    (payload ->> 'location_id')::uuid, (payload ->> 'location_id')::uuid,
    v_pickup, v_return, v_blocked,
    (payload ->> 'status')::public.reservation_status,
    (payload ->> 'rate_plan')::public.rate_plan,
    coalesce((payload ->> 'pickup_method')::public.pickup_method, 'STORE'),
    nullif(payload ->> 'delivery_address', ''),
    coalesce(payload ->> 'protection', 'none'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(payload -> 'add_ons', '[]'::jsonb))), '{}'),
    coalesce(payload ->> 'driver_age_band', '25_PLUS'),
    (payload ->> 'pricing_config_id')::uuid,
    payload -> 'quote',
    coalesce(payload -> 'policy', '{}'::jsonb),
    (payload -> 'quote' ->> 'days')::integer,
    (payload -> 'quote' ->> 'subtotalCents')::integer,
    (payload -> 'quote' ->> 'discountCents')::integer,
    (payload -> 'quote' ->> 'taxCents')::integer,
    (payload -> 'quote' ->> 'totalCents')::integer,
    (payload -> 'quote' ->> 'securityHoldCents')::integer,
    (payload ->> 'booking_source')::public.booking_source,
    nullif(payload ->> 'lead_id', '')::uuid,
    nullif(payload ->> 'expires_at', '')::timestamptz,
    nullif(payload ->> 'customer_notes', ''),
    nullif(payload ->> 'internal_notes', ''),
    nullif(payload ->> 'created_by', '')::uuid
  )
  returning id into v_reservation_id;

  insert into public.vehicle_allocations (vehicle_id, period, reservation_id)
  values (v_vehicle_id, tstzrange(v_pickup, v_blocked), v_reservation_id);

  for v_item in select * from jsonb_array_elements(coalesce(payload -> 'quote' -> 'lines', '[]'::jsonb)) loop
    insert into public.reservation_line_items (reservation_id, type, code, description, quantity, unit_cents, amount_cents, taxable, sort_order)
    values (
      v_reservation_id,
      (v_item ->> 'type')::public.line_item_type,
      v_item ->> 'code',
      v_item ->> 'description',
      coalesce((v_item ->> 'quantity')::numeric, 1),
      coalesce((v_item ->> 'unitCents')::integer, 0),
      (v_item ->> 'amountCents')::integer,
      coalesce((v_item ->> 'taxable')::boolean, true),
      v_index
    );
    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('id', v_reservation_id, 'number', v_number, 'vehicle_id', v_vehicle_id, 'customer_id', v_customer_id);
end;
$$;

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
    select id into v_vehicle_id from public.available_vehicles(p_class_id, p_pickup_at, p_return_at, p_reservation_id, v_res.pickup_location_id) limit 1;
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
