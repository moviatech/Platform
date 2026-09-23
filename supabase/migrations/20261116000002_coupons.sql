create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,29}$'),
  label text,
  kind text not null check (kind in ('PERCENT', 'AMOUNT')),
  percent_bps integer not null default 0 check (percent_bps between 0 and 10000),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  max_discount_cents integer check (max_discount_cents > 0),
  valid_from date,
  valid_to date,
  min_days integer not null default 1 check (min_days >= 1),
  class_ids uuid[],
  location_ids uuid[],
  max_redemptions integer check (max_redemptions > 0),
  per_customer_limit integer check (per_customer_limit > 0),
  first_order_only boolean not null default false,
  stackable boolean not null default false,
  bearer text not null default 'COMPANY' check (bearer in ('COMPANY', 'SHARED')),
  active boolean not null default true,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'PERCENT' and percent_bps > 0) or (kind = 'AMOUNT' and amount_cents > 0)),
  check (valid_from is null or valid_to is null or valid_from <= valid_to)
);

create unique index coupons_code_idx on public.coupons (code);

create trigger coupons_touch before update on public.coupons
for each row execute function public.touch_updated_at();

alter table public.coupons enable row level security;

alter table public.reservations add column coupon_id uuid references public.coupons (id) on delete set null;
create index reservations_coupon_idx on public.reservations (coupon_id) where coupon_id is not null;

create function public.claim_coupon(p_coupon_id uuid, p_customer_id uuid, p_ignore_reservation uuid default null)
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

revoke all on function public.claim_coupon(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_coupon(uuid, uuid, uuid) to service_role;

create or replace function public.create_reservation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  v_coupon_id uuid := nullif(payload ->> 'coupon_id', '')::uuid;
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

  if v_coupon_id is not null then
    perform public.claim_coupon(v_coupon_id, v_customer_id, null);
  end if;

  v_number := public.generate_reservation_number();

  insert into public.reservations (
    number, customer_id, class_id, assigned_vehicle_id, pickup_location_id, return_location_id,
    pickup_at, return_at, blocked_until, status, rate_plan, pickup_method, delivery_address,
    protection, add_ons, driver_age_band, pricing_config_id, quote_snapshot, policy_snapshot,
    rental_days, subtotal_cents, discount_cents, tax_cents, total_cents, security_hold_cents,
    booking_source, lead_id, expires_at, customer_notes, internal_notes, created_by, coupon_id
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
    nullif(payload ->> 'created_by', '')::uuid,
    v_coupon_id
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
$function$;
