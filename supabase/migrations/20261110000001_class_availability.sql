create function public.class_availability(p_location_id uuid, p_from timestamptz, p_window_start time, p_window_end time, p_step_minutes integer, p_days integer default 90)
returns table (class_id uuid, available integer, next_available_date date)
language sql
stable
security definer
set search_path = ''
as $$
  with loc as (
    select l.timezone from public.locations l where l.id = p_location_id
  ),
  cars as (
    select v.id, v.class_id, c.buffer_hours
    from public.vehicles v
    join public.vehicle_classes c on c.id = v.class_id
    where c.active
      and v.condition = 'IN_SERVICE'
      and v.location_id = p_location_id
      and not exists (
        select 1 from public.reservations o
        where o.assigned_vehicle_id = v.id and o.status = 'ACTIVE' and o.return_at < now()
      )
  ),
  busy as (
    select a.vehicle_id, a.period
    from public.vehicle_allocations a
    left join public.reservations r on r.id = a.reservation_id
    where a.vehicle_id in (select k.id from cars k)
      and upper(a.period) > p_from
      and not (r.id is not null and r.status in ('REQUESTED', 'PENDING_PAYMENT') and r.expires_at is not null and r.expires_at < now())
  ),
  free_now as (
    select k.class_id, count(*)::integer as available
    from cars k
    where not exists (
      select 1 from busy b
      where b.vehicle_id = k.id
        and b.period && tstzrange(p_from, p_from + interval '24 hours' + make_interval(hours => k.buffer_hours))
    )
    group by k.class_id
  ),
  slots as (
    select (d.day + p_window_start + make_interval(mins => n.step * p_step_minutes)) at time zone loc.timezone as starts_at, d.day::date as local_date
    from loc
    cross join generate_series((p_from at time zone loc.timezone)::date::timestamp, ((now() at time zone loc.timezone)::date + p_days)::timestamp, interval '1 day') as d(day)
    cross join generate_series(0, greatest(0, floor(extract(epoch from (p_window_end - p_window_start)) / 60 / greatest(p_step_minutes, 1))::integer)) as n(step)
  ),
  free_later as (
    select k.class_id, min(s.local_date) as next_available_date
    from cars k
    join slots s on s.starts_at >= p_from
    where not exists (select 1 from free_now f where f.class_id = k.class_id)
      and not exists (
        select 1 from busy b
        where b.vehicle_id = k.id
          and b.period && tstzrange(s.starts_at, s.starts_at + interval '24 hours' + make_interval(hours => k.buffer_hours))
      )
    group by k.class_id
  )
  select c.id, coalesce(f.available, 0), case when coalesce(f.available, 0) = 0 then n.next_available_date end
  from public.vehicle_classes c
  left join free_now f on f.class_id = c.id
  left join free_later n on n.class_id = c.id
  where c.active
  order by c.sort_order;
$$;

revoke all on function public.class_availability(uuid, timestamptz, time, time, integer, integer) from public, anon, authenticated;
grant execute on function public.class_availability(uuid, timestamptz, time, time, integer, integer) to service_role;
