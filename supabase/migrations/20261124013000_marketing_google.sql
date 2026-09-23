create table public.marketing_report_cache (
  key text primary key check (char_length(key) between 3 and 300),
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

create index marketing_report_cache_age_idx on public.marketing_report_cache (fetched_at);

create table public.marketing_sync_state (
  key text primary key check (char_length(key) between 3 and 300),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.marketing_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb not null default '{}'::jsonb
);

create index marketing_sync_runs_started_idx on public.marketing_sync_runs (started_at desc);

create table public.marketing_ga_daily (
  property text not null check (char_length(property) <= 20),
  day date not null,
  users integer not null default 0,
  new_users integer not null default 0,
  sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  engagement_seconds numeric not null default 0,
  views integer not null default 0,
  key_events numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (property, day)
);

create table public.marketing_ga_channel_daily (
  property text not null check (char_length(property) <= 20),
  day date not null,
  channel text not null check (char_length(channel) <= 120),
  users integer not null default 0,
  sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  key_events numeric not null default 0,
  primary key (property, day, channel)
);

create table public.marketing_gsc_daily (
  site text not null check (char_length(site) <= 200),
  day date not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  position numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (site, day)
);

create table public.marketing_gsc_page_daily (
  site text not null check (char_length(site) <= 200),
  day date not null,
  page text not null check (char_length(page) <= 400),
  clicks integer not null default 0,
  impressions integer not null default 0,
  position numeric not null default 0,
  primary key (site, day, page)
);

create table public.marketing_gsc_query_daily (
  site text not null check (char_length(site) <= 200),
  day date not null,
  query text not null check (char_length(query) <= 400),
  clicks integer not null default 0,
  impressions integer not null default 0,
  position numeric not null default 0,
  primary key (site, day, query)
);

create table public.marketing_url_checks (
  site text not null check (char_length(site) <= 200),
  url text not null check (char_length(url) <= 400),
  verdict text,
  coverage text,
  indexing text,
  fetch_state text,
  robots text,
  canonical text,
  last_crawl timestamptz,
  error text,
  checked_at timestamptz not null default now(),
  primary key (site, url)
);

alter table public.marketing_report_cache enable row level security;
alter table public.marketing_sync_state enable row level security;
alter table public.marketing_sync_runs enable row level security;
alter table public.marketing_ga_daily enable row level security;
alter table public.marketing_ga_channel_daily enable row level security;
alter table public.marketing_gsc_daily enable row level security;
alter table public.marketing_gsc_page_daily enable row level security;
alter table public.marketing_gsc_query_daily enable row level security;
alter table public.marketing_url_checks enable row level security;

revoke all on public.marketing_report_cache, public.marketing_sync_state, public.marketing_sync_runs, public.marketing_ga_daily, public.marketing_ga_channel_daily, public.marketing_gsc_daily, public.marketing_gsc_page_daily, public.marketing_gsc_query_daily, public.marketing_url_checks from public, anon, authenticated;
grant all on public.marketing_report_cache, public.marketing_sync_state, public.marketing_sync_runs, public.marketing_ga_daily, public.marketing_ga_channel_daily, public.marketing_gsc_daily, public.marketing_gsc_page_daily, public.marketing_gsc_query_daily, public.marketing_url_checks to service_role;
