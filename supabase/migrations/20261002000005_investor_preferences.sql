alter table public.investors add column preferences jsonb not null default '{}'::jsonb;
