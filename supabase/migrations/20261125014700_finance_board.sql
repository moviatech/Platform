create table public.fin_vehicle_costs (
  vehicle_id uuid primary key references public.vehicles (id) on delete cascade,
  in_service_on date,
  retired_on date,
  purchase_price_cents bigint check (purchase_price_cents between 0 and 100000000),
  depreciation_months integer check (depreciation_months between 1 and 360),
  monthly_payment_cents bigint check (monthly_payment_cents between 0 and 10000000),
  purchase_tax text check (purchase_tax in ('PAID', 'RESALE', 'UNKNOWN')),
  tax_evidence_path text check (char_length(tax_evidence_path) <= 500),
  insurance_monthly_cents bigint check (insurance_monthly_cents between 0 and 10000000),
  registration_yearly_cents bigint check (registration_yearly_cents between 0 and 10000000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (retired_on is null or in_service_on is null or retired_on > in_service_on),
  check (purchase_price_cents is null or depreciation_months is not null)
);

alter table public.fin_vehicle_costs enable row level security;
revoke all on table public.fin_vehicle_costs from public, anon, authenticated, service_role;
grant select, insert, update on table public.fin_vehicle_costs to service_role;

create table public.fin_bank_balances (
  id bigint generated always as identity primary key,
  account_name text not null check (char_length(btrim(account_name)) between 1 and 80),
  as_of date not null,
  balance_cents bigint not null check (balance_cents between -100000000000 and 100000000000),
  entered_by uuid not null,
  entered_at timestamptz not null default now()
);

create index fin_bank_balances_account_idx on public.fin_bank_balances (account_name, as_of desc, id desc);

alter table public.fin_bank_balances enable row level security;
revoke all on table public.fin_bank_balances from public, anon, authenticated, service_role;
grant select, insert, delete on table public.fin_bank_balances to service_role;
revoke all on sequence public.fin_bank_balances_id_seq from public, anon, authenticated, service_role;

alter table public.expenses
  add column location_id uuid references public.locations (id) on delete restrict,
  add column service_from date,
  add column service_to date,
  add column capital boolean not null default false,
  add constraint expenses_service_period check ((service_from is null) = (service_to is null) and (service_to is null or service_to >= service_from));

create or replace function public.expenses_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'expenses_append_only';
  end if;
  if old.voided_at is null and new.voided_at is not null
    and new.id = old.id and new.spent_on = old.spent_on and new.category = old.category and new.amount_cents = old.amount_cents
    and new.vendor is not distinct from old.vendor and new.method = old.method
    and new.reference is not distinct from old.reference and new.note is not distinct from old.note
    and new.created_at = old.created_at
    and new.location_id is not distinct from old.location_id and new.service_from is not distinct from old.service_from
    and new.service_to is not distinct from old.service_to and new.capital = old.capital then
    return new;
  end if;
  if new.voided_at is not distinct from old.voided_at and new.void_reason is not distinct from old.void_reason
    and new.id = old.id and new.spent_on = old.spent_on and new.category = old.category and new.amount_cents = old.amount_cents
    and new.vendor is not distinct from old.vendor and new.method = old.method
    and new.reference is not distinct from old.reference and new.note is not distinct from old.note
    and new.created_at = old.created_at
    and new.location_id is not distinct from old.location_id and new.service_from is not distinct from old.service_from
    and new.service_to is not distinct from old.service_to and new.capital = old.capital then
    return new;
  end if;
  raise exception 'expenses_append_only';
end;
$$;

create index fin_journal_entries_economic_idx on public.fin_journal_entries (book, economic_date);

create function public.fin_is_test_vehicle(p_class_slug text, p_fleet_number text, p_placeholder boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p_class_slug, ''))) like 'zz-%'
    or coalesce(p_placeholder, false)
    or upper(btrim(coalesce(p_fleet_number, ''))) like 'ZZ-%'
    or upper(btrim(coalesce(p_fleet_number, ''))) like 'PRACTICE%';
$$;

create function public.fin_is_test_order(p_number text, p_class_slug text, p_fleet_number text, p_placeholder boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.fin_is_test_vehicle(p_class_slug, p_fleet_number, p_placeholder)
    or (btrim(coalesce(p_number, '')) <> '' and upper(btrim(p_number)) !~ '^MV-[2-9A-HJ-NP-Z]{6}$');
$$;

create function public.fin_stay_days(p_start timestamptz, p_end timestamptz, p_from date, p_to date)
returns setof date
language sql
stable
set search_path = ''
as $$
  select distinct (g.ts at time zone 'America/Los_Angeles')::date
  from generate_series(
    greatest(p_start, p_from::timestamp at time zone 'America/Los_Angeles'),
    least(p_end, (p_to + 1)::timestamp at time zone 'America/Los_Angeles') - interval '1 microsecond',
    interval '24 hours'
  ) as g(ts)
  where p_start is not null and p_end is not null and p_from is not null and p_to is not null;
$$;

create function public.fin_report_pnl(p_book text, p_from date, p_to date, p_group text)
returns table (group_key text, account text, kind text, name_zh text, name_en text, debit_cents bigint, credit_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_book is null or p_book not in ('live', 'sandbox') then
    raise exception 'invalid_book';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid_range';
  end if;
  if p_group is null or p_group not in ('none', 'vehicle', 'location', 'month', 'channel', 'class') then
    raise exception 'invalid_group';
  end if;
  return query
  select
    case p_group
      when 'vehicle' then l.vehicle_id::text
      when 'location' then l.location_id::text
      when 'month' then to_char(e.economic_date::timestamp, 'YYYY-MM')
      when 'channel' then r.booking_source::text
      when 'class' then coalesce(v.class_id, r.class_id)::text
    end,
    a.code,
    a.kind,
    a.name_zh,
    a.name_en,
    sum(l.debit_cents)::bigint,
    sum(l.credit_cents)::bigint
  from public.fin_journal_entries e
  join public.fin_journal_lines l on l.entry_id = e.id
  join public.fin_accounts a on a.code = l.account
  left join public.reservations r on p_group in ('channel', 'class') and r.id = l.reservation_id
  left join public.vehicles v on p_group = 'class' and v.id = l.vehicle_id
  where e.book = p_book and e.economic_date between p_from and p_to
    and a.kind in ('REVENUE', 'CONTRA_REVENUE', 'COST', 'EXPENSE')
  group by 1, 2, 3, 4, 5
  order by 1, 2;
end;
$$;

create function public.fin_report_cash(p_book text, p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month timestamp;
  v_accounts jsonb;
  v_orders jsonb;
  v_bank jsonb;
  v_flows jsonb;
  v_first date;
  v_owners jsonb;
  v_holds jsonb;
  v_pending jsonb;
begin
  if p_book is null or p_book not in ('live', 'sandbox') then
    raise exception 'invalid_book';
  end if;
  if p_as_of is null then
    raise exception 'invalid_date';
  end if;
  v_month := date_trunc('month', p_as_of::timestamp);

  select coalesce(jsonb_object_agg(x.account, x.balance), '{}'::jsonb) into v_accounts
  from (
    select l.account, sum(l.debit_cents - l.credit_cents)::bigint as balance
    from public.fin_journal_entries e
    join public.fin_journal_lines l on l.entry_id = e.id
    where e.book = p_book and e.economic_date <= p_as_of
      and l.account in ('1010', '1050', '1060', '1070', '1080', '1150', '2190', '2200', '2210', '2300', '2310', '2900', '2920')
    group by l.account
  ) x;

  select jsonb_build_object(
    'receivable', coalesce(sum(f.balance) filter (where f.balance > 0), 0),
    'receivableOrders', count(*) filter (where f.balance > 0),
    'overdueDays', coalesce(max(p_as_of - f.due_on) filter (where f.balance > 0 and f.due_on < p_as_of), 0),
    'prepaid', coalesce(-sum(f.balance) filter (where f.balance < 0 and f.status in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE')), 0),
    'credits', coalesce(-sum(f.balance) filter (where f.balance < 0 and (f.status is null or f.status not in ('REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE'))), 0)
  ) into v_orders
  from (
    select b.balance, r.status::text as status,
      (coalesce(r.actual_return_at, r.cancelled_at, r.return_at) at time zone 'America/Los_Angeles')::date as due_on
    from (
      select l.reservation_id, sum(l.debit_cents - l.credit_cents)::bigint as balance
      from public.fin_journal_entries e
      join public.fin_journal_lines l on l.entry_id = e.id
      where e.book = p_book and e.economic_date <= p_as_of and l.account = '1100' and l.reservation_id is not null
      group by l.reservation_id
      having sum(l.debit_cents - l.credit_cents) <> 0
    ) b
    left join public.reservations r on r.id = b.reservation_id
  ) f;

  select jsonb_build_object('total', coalesce(sum(x.balance_cents), 0), 'latest', max(x.as_of), 'oldest', min(x.as_of), 'accounts', count(*)) into v_bank
  from (
    select distinct on (b.account_name) b.account_name, b.as_of, b.balance_cents
    from public.fin_bank_balances b
    where b.as_of <= p_as_of
    order by b.account_name, b.as_of desc, b.id desc
  ) x;

  select min(e.economic_date) into v_first from public.fin_journal_entries e where e.book = p_book;

  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'net', coalesce(f.net, 0)) order by m.month), '[]'::jsonb) into v_flows
  from generate_series(v_month - interval '3 months', v_month - interval '1 month', interval '1 month') as m(month)
  left join (
    select date_trunc('month', e.economic_date::timestamp) as month, sum(l.debit_cents - l.credit_cents)::bigint as net
    from public.fin_journal_entries e
    join public.fin_journal_lines l on l.entry_id = e.id
    where e.book = p_book and l.account in ('1010', '1050', '1060', '1070', '1080')
      and e.economic_date >= (v_month - interval '3 months')::date and e.economic_date < v_month::date
    group by 1
  ) f on f.month = m.month;

  select jsonb_build_object('count', count(*), 'cents', coalesce(sum(w.amount_cents), 0), 'oldest', min(w.created_at)) into v_owners
  from public.investor_withdrawals w
  join public.investors i on i.id = w.investor_id
  left join public.fin_inclusions x on x.object_type = 'investor' and x.object_id = i.id
  where w.status in ('REQUESTED', 'APPROVED') and coalesce(x.included, not i.house);

  v_owners := v_owners || jsonb_build_object('nextSettle', (
    select min(le.settles_at)
    from public.investor_ledger_entries le
    join public.investors i on i.id = le.investor_id
    left join public.fin_inclusions x on x.object_type = 'investor' and x.object_id = i.id
    where le.bucket = 'PENDING' and le.settles_at > now() and coalesce(x.included, not i.house)
  ));

  select jsonb_build_object('count', count(*), 'cents', coalesce(sum(p.amount_cents), 0)) into v_holds
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  left join public.vehicle_classes c on c.id = r.class_id
  left join public.vehicles v on v.id = r.assigned_vehicle_id
  left join public.fin_inclusions x on x.object_type = 'reservation' and x.object_id = r.id
  where p.kind = 'SECURITY_HOLD' and p.status = 'AUTHORIZED'
    and coalesce(x.included, not public.fin_is_test_order(r.number, c.slug, v.fleet_number, v.is_placeholder));

  v_pending := jsonb_build_object(
    'exceptions', (select count(*) from public.fin_exceptions x where x.book = p_book and x.status = 'OPEN'),
    'approvals', (select count(*) from public.fin_order_resolutions o where o.book = p_book and o.voided_at is null and o.approved_by is null and o.amount_cents > 10000)
  );

  return jsonb_build_object('accounts', v_accounts, 'orders', v_orders, 'bank', v_bank, 'flows', v_flows, 'firstDate', v_first, 'owners', v_owners, 'holds', v_holds, 'pending', v_pending);
end;
$$;

create function public.fin_report_fleet(p_from date, p_to date, p_now timestamptz)
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
    with fleet as (
      select v.id, v.fleet_number, v.license_plate, v.class_id, v.condition::text as condition, v.created_at,
        c.slug, c.name, c.name_zh,
        k.in_service_on, k.retired_on, k.purchase_price_cents, k.depreciation_months, k.monthly_payment_cents,
        k.purchase_tax, k.tax_evidence_path, k.insurance_monthly_cents, k.registration_yearly_cents, k.updated_at,
        coalesce(k.in_service_on, (v.created_at at time zone 'America/Los_Angeles')::date) as service_from,
        case when k.retired_on is null then p_to else least(p_to, k.retired_on - 1) end as service_to,
        exists (
          select 1
          from public.investor_allocations a
          join public.investors i on i.id = a.investor_id
          left join public.fin_inclusions x on x.object_type = 'investor' and x.object_id = i.id
          where a.vehicle_id = v.id and a.effective_from <= p_to and (a.effective_to is null or a.effective_to >= p_from)
            and coalesce(x.included, not i.house)
        ) as owner_car
      from public.vehicles v
      left join public.vehicle_classes c on c.id = v.class_id
      left join public.fin_vehicle_costs k on k.vehicle_id = v.id
      where not public.fin_is_test_vehicle(c.slug, v.fleet_number, v.is_placeholder)
    ),
    service as (
      select f.id as vehicle_id, d.day::date as day
      from fleet f
      cross join lateral generate_series(greatest(p_from, f.service_from)::timestamp, f.service_to::timestamp, interval '1 day') as d(day)
    ),
    counted as (
      select r.id, r.assigned_vehicle_id, r.booking_source::text as source, r.status::text as status,
        coalesce(r.actual_pickup_at, r.pickup_at) as starts_at,
        coalesce(r.actual_return_at, r.return_at) as ends_at,
        greatest(r.total_cents - coalesce(r.tax_cents, 0), 0) as amount_cents
      from public.reservations r
      left join public.vehicle_classes c on c.id = r.class_id
      left join public.vehicles v on v.id = r.assigned_vehicle_id
      left join public.fin_inclusions x on x.object_type = 'reservation' and x.object_id = r.id
      where r.status in ('CONFIRMED', 'ACTIVE', 'COMPLETED')
        and coalesce(x.included, not public.fin_is_test_order(r.number, c.slug, v.fleet_number, v.is_placeholder))
    ),
    order_days as (
      select o.id, o.assigned_vehicle_id as vehicle_id, o.source, d.day
      from counted o
      cross join lateral public.fin_stay_days(o.starts_at, o.ends_at, p_from, p_to) as d(day)
      where o.status in ('ACTIVE', 'COMPLETED') and o.starts_at < v_end and o.ends_at > v_start
    ),
    rented as (
      select distinct od.vehicle_id, od.day from order_days od where od.vehicle_id is not null
    ),
    down as (
      select distinct b.vehicle_id, d.day
      from public.vehicle_blocks b
      cross join lateral public.fin_stay_days(b.starts_at, b.ends_at, p_from, p_to) as d(day)
      where b.type = 'MAINTENANCE' and b.starts_at < v_end and b.ends_at > v_start
    ),
    stats as (
      select s.vehicle_id,
        count(*) as service_days,
        count(r.day) as rented_days,
        count(*) filter (where dn.day is not null and r.day is null) as down_days
      from service s
      left join rented r on r.vehicle_id = s.vehicle_id and r.day = s.day
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
          'inServiceOn', f.in_service_on, 'serviceFrom', f.service_from, 'retiredOn', f.retired_on,
          'purchasePriceCents', f.purchase_price_cents, 'depreciationMonths', f.depreciation_months, 'monthlyPaymentCents', f.monthly_payment_cents,
          'purchaseTax', f.purchase_tax, 'taxEvidencePath', f.tax_evidence_path, 'insuranceMonthlyCents', f.insurance_monthly_cents,
          'registrationYearlyCents', f.registration_yearly_cents, 'costsUpdatedAt', f.updated_at, 'ownerCar', f.owner_car,
          'serviceDays', coalesce(st.service_days, 0), 'rentedDays', coalesce(st.rented_days, 0), 'downDays', coalesce(st.down_days, 0)
        ) order by f.fleet_number), '[]'::jsonb)
        from fleet f
        left join stats st on st.vehicle_id = f.id
      ),
      'channels', (
        select coalesce(jsonb_agg(jsonb_build_object('source', c.source, 'orders', c.orders, 'days', c.days) order by c.source), '[]'::jsonb)
        from (select od.source, count(distinct od.id) as orders, count(*) as days from order_days od group by od.source) c
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

revoke all on function public.fin_is_test_vehicle(text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.fin_is_test_order(text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.fin_stay_days(timestamptz, timestamptz, date, date) from public, anon, authenticated, service_role;
revoke all on function public.fin_report_pnl(text, date, date, text) from public, anon, authenticated;
revoke all on function public.fin_report_cash(text, date) from public, anon, authenticated;
revoke all on function public.fin_report_fleet(date, date, timestamptz) from public, anon, authenticated;

grant execute on function public.fin_report_pnl(text, date, date, text) to service_role;
grant execute on function public.fin_report_cash(text, date) to service_role;
grant execute on function public.fin_report_fleet(date, date, timestamptz) to service_role;
