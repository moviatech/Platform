alter table public.fin_vehicle_costs add column residual_cents bigint;
alter table public.fin_vehicle_costs add constraint fin_vehicle_costs_residual check (residual_cents is null or (residual_cents >= 0 and purchase_price_cents is not null and residual_cents < purchase_price_cents));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-documents', 'finance-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create or replace function public.fin_report_fleet(p_from date, p_to date, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from or p_now is null then
    raise exception 'invalid_range';
  end if;
  v_start := p_from::timestamp at time zone 'America/Los_Angeles';
  v_end := (p_to + 1)::timestamp at time zone 'America/Los_Angeles';
  return (
    with owned as (
      select a.vehicle_id, a.effective_from, a.effective_to, coalesce(x.included, not i.house) as external
      from public.investor_allocations a
      join public.investors i on i.id = a.investor_id
      left join public.fin_inclusions x on x.object_type = 'investor' and x.object_id = i.id
    ),
    lasts as (
      select o.vehicle_id, max(o.effective_to) as last_to, bool_and(o.effective_to is not null) as closed
      from owned o
      group by o.vehicle_id
    ),
    exits as (
      select l.vehicle_id, l.last_to + 1 as exit_on
      from lasts l
      where l.closed and exists (select 1 from owned o where o.vehicle_id = l.vehicle_id and o.external and o.effective_to = l.last_to)
    ),
    fleet as (
      select v.id, v.fleet_number, v.license_plate, v.class_id, v.condition::text as condition, v.created_at,
        c.slug, c.name, c.name_zh,
        k.in_service_on, k.retired_on, k.purchase_price_cents, k.depreciation_months, k.residual_cents, k.monthly_payment_cents,
        k.purchase_tax, k.tax_evidence_path, k.insurance_monthly_cents, k.registration_yearly_cents, k.updated_at,
        e.exit_on,
        coalesce(k.in_service_on, (v.created_at at time zone 'America/Los_Angeles')::date) as service_from,
        case when coalesce(k.retired_on, e.exit_on) is null then p_to else least(p_to, coalesce(k.retired_on, e.exit_on) - 1) end as service_to,
        exists (
          select 1
          from owned o
          where o.vehicle_id = v.id and o.external and o.effective_from <= p_to and (o.effective_to is null or o.effective_to >= p_from)
        ) as owner_car
      from public.vehicles v
      left join public.vehicle_classes c on c.id = v.class_id
      left join public.fin_vehicle_costs k on k.vehicle_id = v.id
      left join exits e on e.vehicle_id = v.id
      where not public.fin_is_test_vehicle(c.slug, v.fleet_number, v.is_placeholder)
    ),
    service as (
      select f.id as vehicle_id, d.day::date as day,
        exists (
          select 1
          from owned o
          where o.vehicle_id = f.id and o.external and o.effective_from <= d.day::date and (o.effective_to is null or o.effective_to >= d.day::date)
        ) as owner_day,
        coalesce(f.purchase_price_cents is not null and f.depreciation_months is not null and d.day::date < (f.service_from + make_interval(months => f.depreciation_months))::date, false) as in_life
      from fleet f
      cross join lateral generate_series(greatest(p_from, f.service_from)::timestamp, f.service_to::timestamp, interval '1 day') as d(day)
    ),
    counted as (
      select r.id, r.assigned_vehicle_id, r.booking_source::text as source, r.status::text as status,
        coalesce(r.actual_pickup_at, r.pickup_at) as starts_at,
        coalesce(r.actual_return_at, r.return_at) as ends_at,
        greatest(r.total_cents - coalesce(r.tax_cents, 0), 0) as amount_cents,
        coalesce(x.included, exists (
          select 1
          from public.payments p
          join public.stripe_balance_transactions t on t.payment_intent_id = p.stripe_payment_intent_id and t.livemode
          where p.reservation_id = r.id and p.stripe_payment_intent_id is not null
        )) as in_books
      from public.reservations r
      left join public.vehicle_classes c on c.id = r.class_id
      left join public.vehicles v on v.id = r.assigned_vehicle_id
      left join public.fin_inclusions x on x.object_type = 'reservation' and x.object_id = r.id
      where r.status in ('CONFIRMED', 'ACTIVE', 'COMPLETED')
        and coalesce(x.included, not public.fin_is_test_order(r.number, c.slug, v.fleet_number, v.is_placeholder))
    ),
    order_days as (
      select o.id, o.assigned_vehicle_id as vehicle_id, o.source, o.in_books, d.day
      from counted o
      cross join lateral public.fin_stay_days(o.starts_at, o.ends_at, p_from, p_to) as d(day)
      where o.status in ('ACTIVE', 'COMPLETED') and o.starts_at < v_end and o.ends_at > v_start
    ),
    rented as (
      select distinct od.vehicle_id, od.day from order_days od where od.vehicle_id is not null
    ),
    booked as (
      select distinct od.vehicle_id, od.day from order_days od where od.vehicle_id is not null and od.in_books
    ),
    down as (
      select distinct b.vehicle_id, d.day
      from public.vehicle_blocks b
      cross join lateral public.fin_stay_days(b.starts_at, b.ends_at, p_from, p_to) as d(day)
      where b.starts_at < v_end and b.ends_at > v_start
    ),
    stats as (
      select s.vehicle_id,
        count(*) as service_days,
        count(r.day) as rented_days,
        count(k.day) as revenue_days,
        count(*) filter (where dn.day is not null and r.day is null) as down_days,
        count(*) filter (where s.owner_day) as owner_days,
        count(*) filter (where s.in_life and not s.owner_day) as depreciation_days
      from service s
      left join rented r on r.vehicle_id = s.vehicle_id and r.day = s.day
      left join booked k on k.vehicle_id = s.vehicle_id and k.day = s.day
      left join down dn on dn.vehicle_id = s.vehicle_id and dn.day = s.day
      group by s.vehicle_id
    ),
    ahead as (
      select o.starts_at, o.ends_at, o.amount_cents
      from counted o
      where o.status in ('CONFIRMED', 'ACTIVE') and o.ends_at > p_now and o.starts_at < p_now + interval '90 days' and o.ends_at > o.starts_at
    ),
    windows as (
      select w.n,
        greatest(a.starts_at, p_now) as from_at,
        least(a.ends_at, p_now + make_interval(days => w.n)) as to_at,
        a.starts_at, a.ends_at, a.amount_cents
      from (values (30), (60), (90)) as w(n)
      left join ahead a on true
    )
    select jsonb_build_object(
      'vehicles', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', f.id, 'fleetNumber', f.fleet_number, 'plate', f.license_plate, 'classId', f.class_id, 'classSlug', f.slug,
          'className', f.name, 'classNameZh', f.name_zh, 'condition', f.condition, 'createdOn', (f.created_at at time zone 'America/Los_Angeles')::date,
          'inServiceOn', f.in_service_on, 'serviceFrom', f.service_from, 'retiredOn', f.retired_on, 'ownerExitOn', f.exit_on,
          'purchasePriceCents', f.purchase_price_cents, 'depreciationMonths', f.depreciation_months, 'residualCents', f.residual_cents, 'monthlyPaymentCents', f.monthly_payment_cents,
          'purchaseTax', f.purchase_tax, 'taxEvidencePath', f.tax_evidence_path, 'insuranceMonthlyCents', f.insurance_monthly_cents,
          'registrationYearlyCents', f.registration_yearly_cents, 'costsUpdatedAt', f.updated_at, 'ownerCar', f.owner_car,
          'serviceDays', coalesce(st.service_days, 0), 'rentedDays', coalesce(st.rented_days, 0), 'revenueDays', coalesce(st.revenue_days, 0), 'downDays', coalesce(st.down_days, 0),
          'ownerDays', coalesce(st.owner_days, 0), 'depreciationDays', coalesce(st.depreciation_days, 0)
        ) order by f.fleet_number), '[]'::jsonb)
        from fleet f
        left join stats st on st.vehicle_id = f.id
      ),
      'channels', (
        select coalesce(jsonb_agg(jsonb_build_object('source', c.source, 'orders', c.orders, 'days', c.days) order by c.source), '[]'::jsonb)
        from (select od.source, count(distinct od.id) as orders, count(*) as days from order_days od where od.in_books group by od.source) c
      ),
      'forward', (
        select coalesce(jsonb_agg(jsonb_build_object('days', x.n, 'bookedDays', x.booked_days, 'revenueCents', x.revenue_cents) order by x.n), '[]'::jsonb)
        from (
          select w.n,
            coalesce(sum(ceil(extract(epoch from (w.to_at - w.from_at)) / 86400.0)) filter (where w.starts_at is not null and w.to_at > w.from_at), 0)::bigint as booked_days,
            coalesce(round(sum(w.amount_cents * extract(epoch from (w.to_at - w.from_at)) / extract(epoch from (w.ends_at - w.starts_at))) filter (where w.starts_at is not null and w.to_at > w.from_at)), 0)::bigint as revenue_cents
          from windows w
          group by w.n
        ) x
      )
    )
  );
end;
$$;
