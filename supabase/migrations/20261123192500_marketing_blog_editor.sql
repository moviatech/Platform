create table public.blog_articles (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  category text not null,
  title_zh text not null default '',
  title_en text not null default '',
  draft jsonb not null,
  live jsonb,
  live_summary jsonb,
  live_draft jsonb,
  publish_at timestamptz,
  rev integer not null default 1,
  live_rev integer,
  catalog_synced boolean not null default false,
  preview_token text unique,
  preview_expires_at timestamptz,
  created_by uuid references public.staff_members (user_id) on delete set null,
  updated_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_articles_published_shape check (status = 'DRAFT' or (live is not null and live_summary is not null and publish_at is not null and live_rev is not null))
);

create index blog_articles_public_idx on public.blog_articles (publish_at desc) where status = 'PUBLISHED';
create index blog_articles_unsynced_idx on public.blog_articles (publish_at) where status = 'PUBLISHED' and not catalog_synced;

create table public.blog_article_revisions (
  id uuid primary key default gen_random_uuid(),
  slug text not null references public.blog_articles (slug) on delete cascade on update cascade,
  kind text not null check (kind in ('SAVE', 'PUBLISH', 'RESTORE', 'IMPORT')),
  draft jsonb not null,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index blog_article_revisions_slug_idx on public.blog_article_revisions (slug, created_at desc);

create table public.blog_media (
  id uuid primary key default gen_random_uuid(),
  slug text references public.blog_articles (slug) on delete cascade on update cascade,
  src text not null unique,
  path text unique,
  width integer not null check (width between 1 and 20000),
  height integer not null check (height between 1 and 20000),
  bytes integer not null default 0 check (bytes >= 0),
  blur text,
  name text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index blog_media_slug_idx on public.blog_media (slug, created_at);

create table public.blog_tags (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 60),
  label_zh text not null check (char_length(label_zh) between 1 and 60),
  label_en text not null check (char_length(label_en) between 1 and 60),
  created_at timestamptz not null default now()
);

alter table public.blog_articles enable row level security;
alter table public.blog_article_revisions enable row level security;
alter table public.blog_media enable row level security;
alter table public.blog_tags enable row level security;
revoke all on public.blog_articles, public.blog_article_revisions, public.blog_media, public.blog_tags from public, anon, authenticated;
grant all on public.blog_articles, public.blog_article_revisions, public.blog_media, public.blog_tags to service_role;

alter table public.blog_posts add column source text not null default 'site' check (source in ('site', 'cms'));

create or replace function public.record_blog_view(p_slug text, p_title_zh text, p_title_en text, p_category text, p_published_at timestamptz, p_cover_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.blog_posts (slug, title_zh, title_en, category, published_at, cover_url, views, last_viewed_at)
  values (p_slug, coalesce(p_title_zh, ''), coalesce(p_title_en, ''), p_category, p_published_at, p_cover_url, 1, now())
  on conflict (slug) do update set
    title_zh = case when public.blog_posts.source = 'site' and excluded.title_zh <> '' then excluded.title_zh else public.blog_posts.title_zh end,
    title_en = case when public.blog_posts.source = 'site' and excluded.title_en <> '' then excluded.title_en else public.blog_posts.title_en end,
    category = case when public.blog_posts.source = 'site' then coalesce(excluded.category, public.blog_posts.category) else public.blog_posts.category end,
    published_at = case when public.blog_posts.source = 'site' then coalesce(excluded.published_at, public.blog_posts.published_at) else public.blog_posts.published_at end,
    cover_url = case when public.blog_posts.source = 'site' then coalesce(excluded.cover_url, public.blog_posts.cover_url) else public.blog_posts.cover_url end,
    views = public.blog_posts.views + 1,
    last_viewed_at = now();

  insert into public.blog_post_views (slug, day, count)
  values (p_slug, (now() at time zone 'America/Los_Angeles')::date, 1)
  on conflict (slug, day) do update set count = public.blog_post_views.count + 1;
end
$$;

create function public.blog_sync_catalog() returns integer
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
      a.publish_at
    from public.blog_articles a
    where a.status = 'PUBLISHED' and not a.catalog_synced and a.publish_at <= now()
    for update skip locked
  ), written as (
    insert into public.blog_posts (slug, title_zh, title_en, category, cover_url, published_at, source, hidden)
    select d.slug, d.title_zh, d.title_en, d.category, case when d.cover like '/%' then 'https://www.moviatech.ai' || d.cover else d.cover end, d.publish_at, 'cms', false
    from due d
    on conflict (slug) do update set
      title_zh = excluded.title_zh,
      title_en = excluded.title_en,
      category = excluded.category,
      cover_url = excluded.cover_url,
      published_at = excluded.published_at,
      source = 'cms',
      hidden = false
    returning slug
  )
  update public.blog_articles a set catalog_synced = true from written w where a.slug = w.slug;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.blog_sync_catalog() from public, anon, authenticated;
grant execute on function public.blog_sync_catalog() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-media', 'blog-media', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

insert into public.blog_tags (id, label_zh, label_en) values
  ('charging', '充电', 'Charging'),
  ('supercharger', '超级充电站', 'Superchargers'),
  ('fsd', 'FSD（监督版）', 'FSD (Supervised)'),
  ('first-time', '新手指南', 'First-Timers'),
  ('tesla-tips', '特斯拉用车', 'Tesla Tips'),
  ('road-rules', '交通规则', 'Road Rules'),
  ('california-driving', '加州自驾', 'Driving in California'),
  ('safety', '安全驾驶', 'Safe Driving'),
  ('road-trip', '自驾攻略', 'Road Trips'),
  ('fall-colors', '加州秋色', 'Fall Colors'),
  ('eastern-sierra', '东塞拉', 'Eastern Sierra'),
  ('traffic-stops', '遇到警察', 'Traffic Stops'),
  ('collision-reports', '事故报告', 'Collision Reports'),
  ('traffic-tickets', '交通罚单', 'Traffic Tickets'),
  ('highway-1', '加州一号公路', 'Highway 1'),
  ('big-sur', 'Big Sur', 'Big Sur'),
  ('winter-driving', '冬季驾驶', 'Winter Driving'),
  ('los-angeles', '洛杉矶', 'Los Angeles'),
  ('bioluminescence', '蓝眼泪', 'Bioluminescence'),
  ('san-diego', '圣地亚哥', 'San Diego'),
  ('orange-county', '橙县', 'Orange County'),
  ('las-vegas', '拉斯维加斯', 'Las Vegas'),
  ('software-updates', '软件更新', 'Software Updates'),
  ('international-visitors', '海外游客', 'International Visitors'),
  ('rental-insurance', '租车保险', 'Rental Insurance'),
  ('irvine', '尔湾', 'Irvine'),
  ('parking', '停车', 'Parking'),
  ('toll-roads', '收费公路', 'Toll Roads'),
  ('damage-waiver', '车损减免', 'Damage Waivers'),
  ('liability-coverage', '第三方责任保障', 'Liability Coverage'),
  ('credit-card-coverage', '信用卡租车保障', 'Credit Card Rental Coverage')
on conflict (id) do nothing;
