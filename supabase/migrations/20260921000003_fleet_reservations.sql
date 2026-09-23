create type public.vehicle_condition as enum ('IN_SERVICE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'ACCIDENT_HOLD');
create type public.clean_state as enum ('READY', 'NEEDS_CLEANING', 'NEEDS_CHARGING', 'NEEDS_BOTH');
create type public.block_type as enum ('MAINTENANCE', 'OWNER_USE', 'HOLD', 'OTHER');
create type public.reservation_status as enum ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED');
create type public.rate_plan as enum ('PAY_NOW', 'PAY_LATER');
create type public.pickup_method as enum ('STORE', 'DELIVERY');
create type public.booking_source as enum ('WEB', 'STAFF', 'PHONE', 'WECHAT');
create type public.payment_state as enum ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');
create type public.verification_state as enum ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED');
create type public.agreement_state as enum ('PENDING', 'SIGNED');
create type public.hold_state as enum ('NONE', 'AUTHORIZED', 'CAPTURED', 'RELEASED', 'FAILED');
create type public.line_item_type as enum ('RENTAL', 'PROTECTION', 'ADD_ON', 'DELIVERY', 'YOUNG_DRIVER', 'DISCOUNT', 'TAX', 'FEE', 'ADDITIONAL');

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_zh text,
  address text,
  timezone text not null default 'America/Los_Angeles',
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 3000),
  active boolean not null default true,
  pickup_instructions text,
  pickup_instructions_zh text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicle_classes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  name_zh text,
  model text not null check (model in ('model-y', 'cybertruck')),
  active boolean not null default true,
  base_daily_rate_cents integer not null check (base_daily_rate_cents >= 0),
  security_hold_cents integer not null default 50000 check (security_hold_cents >= 0),
  buffer_hours integer not null default 3 check (buffer_hours between 0 and 72),
  seats integer,
  range_miles integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.vehicle_classes (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  fleet_number text not null unique,
  vin text unique,
  license_plate text,
  year integer,
  exterior_color text,
  condition public.vehicle_condition not null default 'IN_SERVICE',
  clean_state public.clean_state not null default 'READY',
  battery_level integer check (battery_level between 0 and 100),
  odometer integer check (odometer >= 0),
  is_placeholder boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vehicles_class_idx on public.vehicles (class_id, condition);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  wechat text,
  preferred_language text not null default 'en',
  date_of_birth date,
  stripe_customer_id text unique,
  dnr_flag boolean not null default false,
  dnr_reason text,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customers_email_idx on public.customers (lower(email)) where email is not null;
create index customers_phone_idx on public.customers (phone);

create table public.pricing_configs (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  effective_from timestamptz not null default now(),
  data jsonb not null,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.rate_overrides (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.vehicle_classes (id) on delete cascade,
  date_from date not null,
  date_to date not null,
  daily_rate_cents integer not null check (daily_rate_cents >= 0),
  note text,
  created_at timestamptz not null default now(),
  check (date_to >= date_from)
);

create index rate_overrides_class_idx on public.rate_overrides (class_id, date_from, date_to);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  input jsonb not null,
  result jsonb not null,
  pricing_config_id uuid not null references public.pricing_configs (id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.customers (id) on delete restrict,
  class_id uuid not null references public.vehicle_classes (id) on delete restrict,
  assigned_vehicle_id uuid references public.vehicles (id) on delete restrict,
  pickup_location_id uuid not null references public.locations (id) on delete restrict,
  return_location_id uuid not null references public.locations (id) on delete restrict,
  pickup_at timestamptz not null,
  return_at timestamptz not null,
  blocked_until timestamptz not null,
  status public.reservation_status not null,
  rate_plan public.rate_plan not null,
  pickup_method public.pickup_method not null default 'STORE',
  delivery_address text,
  protection text not null default 'none',
  add_ons text[] not null default '{}',
  driver_age_band text not null default '25_PLUS' check (driver_age_band in ('25_PLUS', '21_24')),
  payment_state public.payment_state not null default 'UNPAID',
  verification_state public.verification_state not null default 'PENDING',
  agreement_state public.agreement_state not null default 'PENDING',
  hold_state public.hold_state not null default 'NONE',
  pricing_config_id uuid not null references public.pricing_configs (id) on delete restrict,
  quote_snapshot jsonb not null,
  policy_snapshot jsonb not null default '{}'::jsonb,
  rental_days integer not null check (rental_days > 0),
  subtotal_cents integer not null,
  discount_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null,
  security_hold_cents integer not null default 0,
  currency text not null default 'usd',
  booking_source public.booking_source not null,
  lead_id uuid references public.leads (id) on delete set null,
  expires_at timestamptz,
  actual_pickup_at timestamptz,
  actual_return_at timestamptz,
  start_odometer integer,
  end_odometer integer,
  customer_notes text,
  internal_notes text,
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (return_at > pickup_at),
  check (blocked_until >= return_at)
);

create index reservations_customer_idx on public.reservations (customer_id);
create index reservations_status_idx on public.reservations (status, pickup_at);
create index reservations_pickup_idx on public.reservations (pickup_at);
create index reservations_return_idx on public.reservations (return_at);
create index reservations_vehicle_idx on public.reservations (assigned_vehicle_id);

create table public.reservation_line_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  type public.line_item_type not null,
  code text not null,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_cents integer not null default 0,
  amount_cents integer not null,
  taxable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index reservation_line_items_idx on public.reservation_line_items (reservation_id, sort_order);

create table public.vehicle_blocks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  type public.block_type not null default 'MAINTENANCE',
  reason text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.vehicle_allocations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  period tstzrange not null,
  reservation_id uuid unique references public.reservations (id) on delete cascade,
  block_id uuid unique references public.vehicle_blocks (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((reservation_id is null) <> (block_id is null)),
  check (not isempty(period)),
  constraint vehicle_allocations_no_overlap exclude using gist (vehicle_id with =, period with &&)
);

create trigger locations_touch before update on public.locations for each row execute function public.touch_updated_at();
create trigger vehicle_classes_touch before update on public.vehicle_classes for each row execute function public.touch_updated_at();
create trigger vehicles_touch before update on public.vehicles for each row execute function public.touch_updated_at();
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
create trigger reservations_touch before update on public.reservations for each row execute function public.touch_updated_at();

create function public.generate_reservation_number() returns text
language plpgsql
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
begin
  loop
    candidate := 'MV-';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.reservations where number = candidate);
  end loop;
  return candidate;
end;
$$;

create function public.expire_stale_reservations() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  with stale as (
    update public.reservations
    set status = 'EXPIRED', assigned_vehicle_id = null
    where status in ('REQUESTED', 'PENDING_PAYMENT') and expires_at is not null and expires_at < now()
    returning id
  ), released as (
    delete from public.vehicle_allocations a using stale s where a.reservation_id = s.id
  )
  select count(*) into affected from stale;
  return affected;
end;
$$;

create function public.available_vehicles(p_class_id uuid, p_pickup_at timestamptz, p_return_at timestamptz, p_ignore_reservation uuid default null)
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

create function public.create_reservation(payload jsonb) returns jsonb
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
  elsif v_email is not null then
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

create function public.assign_reservation_vehicle(p_reservation_id uuid, p_vehicle_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'reservation_not_found';
  end if;
  if v_res.status not in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED') then
    raise exception 'reservation_not_assignable';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_res.class_id::text));
  if not exists (
    select 1 from public.available_vehicles(
      (select class_id from public.vehicles where id = p_vehicle_id), v_res.pickup_at, v_res.return_at, p_reservation_id
    ) where id = p_vehicle_id
  ) then
    raise exception 'vehicle_not_available';
  end if;
  update public.vehicle_allocations set vehicle_id = p_vehicle_id where reservation_id = p_reservation_id;
  update public.reservations set assigned_vehicle_id = p_vehicle_id where id = p_reservation_id;
end;
$$;

create function public.set_reservation_status(p_reservation_id uuid, p_status public.reservation_status, p_reason text default null) returns public.reservation_status
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
    update public.reservations set status = p_status, actual_pickup_at = coalesce(actual_pickup_at, now()) where id = p_reservation_id;
  elsif p_status = 'COMPLETED' then
    select buffer_hours into v_buffer from public.vehicle_classes where id = v_res.class_id;
    update public.reservations
    set status = p_status, actual_return_at = coalesce(actual_return_at, now()), completed_at = now()
    where id = p_reservation_id;
    update public.vehicle_allocations
    set period = tstzrange(lower(period), greatest(lower(period) + interval '1 minute', now() + make_interval(hours => v_buffer)))
    where reservation_id = p_reservation_id
      and now() + make_interval(hours => v_buffer) < upper(period);
  else
    update public.reservations
    set status = p_status, cancelled_at = now(), cancel_reason = p_reason, assigned_vehicle_id = null
    where id = p_reservation_id;
    delete from public.vehicle_allocations where reservation_id = p_reservation_id;
  end if;

  return p_status;
end;
$$;

create function public.create_vehicle_block(p_vehicle_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_type public.block_type, p_reason text, p_created_by uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block_id uuid;
begin
  perform public.expire_stale_reservations();
  insert into public.vehicle_blocks (vehicle_id, starts_at, ends_at, type, reason, created_by)
  values (p_vehicle_id, p_starts_at, p_ends_at, p_type, nullif(p_reason, ''), p_created_by)
  returning id into v_block_id;
  insert into public.vehicle_allocations (vehicle_id, period, block_id)
  values (p_vehicle_id, tstzrange(p_starts_at, p_ends_at), v_block_id);
  return v_block_id;
end;
$$;

revoke all on function public.expire_stale_reservations() from public, anon, authenticated;
revoke all on function public.create_reservation(jsonb) from public, anon, authenticated;
revoke all on function public.assign_reservation_vehicle(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_reservation_status(uuid, public.reservation_status, text) from public, anon, authenticated;
revoke all on function public.create_vehicle_block(uuid, timestamptz, timestamptz, public.block_type, text, uuid) from public, anon, authenticated;
revoke all on function public.available_vehicles(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_reservations() to service_role;
grant execute on function public.create_reservation(jsonb) to service_role;
grant execute on function public.assign_reservation_vehicle(uuid, uuid) to service_role;
grant execute on function public.set_reservation_status(uuid, public.reservation_status, text) to service_role;
grant execute on function public.create_vehicle_block(uuid, timestamptz, timestamptz, public.block_type, text, uuid) to service_role;
grant execute on function public.available_vehicles(uuid, timestamptz, timestamptz, uuid) to service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'locations', 'vehicle_classes', 'vehicles', 'customers', 'pricing_configs', 'rate_overrides',
    'quotes', 'reservations', 'reservation_line_items', 'vehicle_blocks', 'vehicle_allocations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_staff()))', t || '_staff_read', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;
