create unlogged table public.rate_counters (
  key text primary key check (char_length(key) between 1 and 120),
  window_start timestamptz not null default now(),
  expires_at timestamptz not null,
  count integer not null default 1 check (count >= 1)
);

create index rate_counters_expires_at_idx on public.rate_counters (expires_at);

alter table public.rate_counters enable row level security;
revoke all on table public.rate_counters from public, anon, authenticated;
grant all on table public.rate_counters to service_role;

create function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, count integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_window interval;
  v_now timestamptz;
  v_expires timestamptz;
  v_count integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 120 or p_limit is null or p_limit not between 1 and 1000 or p_window_seconds is null or p_window_seconds not between 10 and 86400 then
    raise exception 'rate_limit_invalid';
  end if;
  v_window := make_interval(secs => p_window_seconds);

  for attempt in 1..3 loop
    v_now := clock_timestamp();
    insert into public.rate_counters as c (key, window_start, expires_at, count)
    values (p_key, v_now, v_now + v_window, 1)
    on conflict (key) do update
      set window_start = case when c.expires_at <= v_now then v_now else c.window_start end,
          expires_at = case when c.expires_at <= v_now then v_now + v_window else c.expires_at end,
          count = case when c.expires_at <= v_now then 1 else c.count + 1 end
      where c.expires_at <= v_now or c.count < p_limit
    returning c.count into v_count;
    if found then
      return query select true, v_count, 0;
      return;
    end if;

    v_now := clock_timestamp();
    select c.expires_at, c.count into v_expires, v_count from public.rate_counters c where c.key = p_key;
    if found and v_expires > v_now and v_count >= p_limit then
      return query select false, v_count, greatest(1, ceil(extract(epoch from v_expires - v_now))::integer);
      return;
    end if;
  end loop;

  raise exception 'rate_limit_contended';
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

select cron.schedule(
  'movia-rate-sweep',
  '*/10 * * * *',
  $job$
  delete from public.rate_counters where expires_at < now();
  $job$
);

select cron.schedule(
  'movia-cron-trim',
  '41 10 * * *',
  $job$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  $job$
);
