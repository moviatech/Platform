create table public.blog_posts (
  slug text primary key,
  title_zh text not null default '',
  title_en text not null default '',
  category text,
  cover_url text,
  published_at timestamptz,
  featured boolean not null default false,
  hidden boolean not null default false,
  views bigint not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blog_post_views (
  slug text not null references public.blog_posts (slug) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (slug, day)
);

create trigger blog_posts_touch before update on public.blog_posts for each row execute function public.touch_updated_at();

alter table public.blog_posts enable row level security;
alter table public.blog_post_views enable row level security;
revoke all on public.blog_posts from anon;
revoke all on public.blog_post_views from anon;

create policy blog_posts_staff on public.blog_posts
for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy blog_post_views_staff_read on public.blog_post_views
for select to authenticated using ((select public.is_staff()));

create function public.record_blog_view(p_slug text, p_title_zh text, p_title_en text, p_category text, p_published_at timestamptz, p_cover_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.blog_posts (slug, title_zh, title_en, category, published_at, cover_url, views, last_viewed_at)
  values (p_slug, coalesce(p_title_zh, ''), coalesce(p_title_en, ''), p_category, p_published_at, p_cover_url, 1, now())
  on conflict (slug) do update set
    title_zh = case when excluded.title_zh <> '' then excluded.title_zh else public.blog_posts.title_zh end,
    title_en = case when excluded.title_en <> '' then excluded.title_en else public.blog_posts.title_en end,
    category = coalesce(excluded.category, public.blog_posts.category),
    published_at = coalesce(excluded.published_at, public.blog_posts.published_at),
    cover_url = coalesce(excluded.cover_url, public.blog_posts.cover_url),
    views = public.blog_posts.views + 1,
    last_viewed_at = now();

  insert into public.blog_post_views (slug, day, count)
  values (p_slug, (now() at time zone 'America/Los_Angeles')::date, 1)
  on conflict (slug, day) do update set count = public.blog_post_views.count + 1;
end
$$;

revoke all on function public.record_blog_view(text, text, text, text, timestamptz, text) from public, anon;

insert into public.blog_posts (slug, title_zh, title_en, category, published_at, cover_url) values
  ('us-driving-six-moments', '第一次在美国开车？这 6 个路况别按国内习惯来', 'New to Driving in California? 6 Situations That Catch Visitors Off Guard', 'driving', '2026-09-22 08:00:00-07', 'https://www.moviatech.ai/blog/us-driving-cover.214e9bbf.webp'),
  ('first-day-tesla-charging-fsd-guide', '第一次开特斯拉？从取车到第一次超充，这篇就够了', 'Your First Tesla Rental: Charging, Superchargers & FSD, Explained', 'tips', '2026-09-22 08:00:00-07', 'https://www.moviatech.ai/blog/first-day-cover.c90e7d47.webp')
on conflict (slug) do nothing;
