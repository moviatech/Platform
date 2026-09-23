revoke all on function public.record_blog_view(text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_blog_view(text, text, text, text, timestamptz, text) to service_role;

drop policy blog_posts_staff on public.blog_posts;
create policy blog_posts_staff_read on public.blog_posts for select to authenticated using ((select public.is_hq_staff()));
revoke insert, update, delete, truncate on public.blog_posts from authenticated;

create or replace function public.blog_sync_catalog() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select a.slug,
      coalesce(a.live -> 'zh' ->> 'title', '') as title_zh,
      coalesce(a.live -> 'en' ->> 'title', '') as title_en,
      a.live ->> 'category' as category,
      a.live -> 'cover' ->> 'src' as cover,
      a.live ->> 'published' as published,
      a.publish_at
    from public.blog_articles a
    where a.status = 'PUBLISHED' and not a.catalog_synced and a.publish_at <= now()
    for update skip locked
  ), written as (
    insert into public.blog_posts (slug, title_zh, title_en, category, cover_url, published_at, source, hidden)
    select d.slug, d.title_zh, d.title_en, d.category,
      case when d.cover like '/%' then 'https://www.moviatech.ai' || d.cover else d.cover end,
      case
        when d.published ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and d.published < to_char(d.publish_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD')
          then (d.published::date + time '08:00') at time zone 'America/Los_Angeles'
        else d.publish_at
      end,
      'cms',
      d.slug like 'zz-mkt-%'
    from due d
    on conflict (slug) do update set
      title_zh = excluded.title_zh,
      title_en = excluded.title_en,
      category = excluded.category,
      cover_url = excluded.cover_url,
      published_at = excluded.published_at,
      source = 'cms',
      hidden = excluded.hidden
    returning slug
  )
  update public.blog_articles a set catalog_synced = true from written w where a.slug = w.slug;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

select cron.schedule('movia-marketing-blog-sync', '*/5 * * * *', $job$select public.blog_sync_catalog()$job$);
