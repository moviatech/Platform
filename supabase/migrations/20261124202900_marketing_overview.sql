create or replace function public.marketing_gsc_page_compare(p_site text, p_from date, p_to date, p_prev_from date, p_prev_to date)
returns table (page text, clicks bigint, impressions bigint, "position" double precision, prev_clicks bigint, prev_impressions bigint, prev_position double precision)
language sql
stable
set search_path = ''
as $$
  with grouped as (
    select d.page,
      coalesce(sum(d.clicks) filter (where d.day between p_from and p_to), 0)::bigint as clicks,
      coalesce(sum(d.impressions) filter (where d.day between p_from and p_to), 0)::bigint as impressions,
      coalesce(sum(d.position * d.impressions) filter (where d.day between p_from and p_to), 0)::double precision as weighted,
      coalesce(sum(d.clicks) filter (where d.day between p_prev_from and p_prev_to), 0)::bigint as prev_clicks,
      coalesce(sum(d.impressions) filter (where d.day between p_prev_from and p_prev_to), 0)::bigint as prev_impressions,
      coalesce(sum(d.position * d.impressions) filter (where d.day between p_prev_from and p_prev_to), 0)::double precision as prev_weighted
    from public.marketing_gsc_page_daily d
    where d.site = p_site and (d.day between p_from and p_to or d.day between p_prev_from and p_prev_to)
    group by d.page
  )
  select g.page, g.clicks, g.impressions,
    case when g.impressions > 0 then g.weighted / g.impressions else 0 end,
    g.prev_clicks, g.prev_impressions,
    case when g.prev_impressions > 0 then g.prev_weighted / g.prev_impressions else 0 end
  from grouped g
  where g.impressions > 0 or g.prev_impressions > 0
  order by g.impressions desc, g.prev_impressions desc, g.page
  limit 1000
$$;

create or replace function public.marketing_gsc_query_compare(p_site text, p_from date, p_to date, p_prev_from date, p_prev_to date)
returns table (query text, clicks bigint, impressions bigint, "position" double precision, prev_clicks bigint, prev_impressions bigint, prev_position double precision)
language sql
stable
set search_path = ''
as $$
  with grouped as (
    select d.query,
      coalesce(sum(d.clicks) filter (where d.day between p_from and p_to), 0)::bigint as clicks,
      coalesce(sum(d.impressions) filter (where d.day between p_from and p_to), 0)::bigint as impressions,
      coalesce(sum(d.position * d.impressions) filter (where d.day between p_from and p_to), 0)::double precision as weighted,
      coalesce(sum(d.clicks) filter (where d.day between p_prev_from and p_prev_to), 0)::bigint as prev_clicks,
      coalesce(sum(d.impressions) filter (where d.day between p_prev_from and p_prev_to), 0)::bigint as prev_impressions,
      coalesce(sum(d.position * d.impressions) filter (where d.day between p_prev_from and p_prev_to), 0)::double precision as prev_weighted
    from public.marketing_gsc_query_daily d
    where d.site = p_site and (d.day between p_from and p_to or d.day between p_prev_from and p_prev_to)
    group by d.query
  )
  select g.query, g.clicks, g.impressions,
    case when g.impressions > 0 then g.weighted / g.impressions else 0 end,
    g.prev_clicks, g.prev_impressions,
    case when g.prev_impressions > 0 then g.prev_weighted / g.prev_impressions else 0 end
  from grouped g
  where g.impressions > 0 or g.prev_impressions > 0
  order by g.impressions desc, g.prev_impressions desc, g.query
  limit 1000
$$;

revoke all on function public.marketing_gsc_page_compare(text, date, date, date, date) from public, anon, authenticated;
revoke all on function public.marketing_gsc_query_compare(text, date, date, date, date) from public, anon, authenticated;
grant execute on function public.marketing_gsc_page_compare(text, date, date, date, date) to service_role;
grant execute on function public.marketing_gsc_query_compare(text, date, date, date, date) to service_role;
