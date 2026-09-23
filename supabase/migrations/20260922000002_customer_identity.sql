alter table public.customers
  add column phone_normalized text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored;

create unique index customers_phone_normalized_idx on public.customers (phone_normalized)
  where phone_normalized is not null and length(phone_normalized) >= 7;

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
  v_phone text := nullif(regexp_replace(coalesce(v_customer ->> 'phone', ''), '\D', '', 'g'), '');
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
    select id into v_vehicle_id from public.available_vehicles(v_class.id, v_pickup, v_return)
    where id = (payload ->> 'vehicle_id')::uuid;
  else
    select id into v_vehicle_id from public.available_vehicles(v_class.id, v_pickup, v_return) limit 1;
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
  if v_customer_id is null and v_phone is not null and length(v_phone) >= 7 then
    select id into v_customer_id from public.customers where phone_normalized = v_phone;
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
