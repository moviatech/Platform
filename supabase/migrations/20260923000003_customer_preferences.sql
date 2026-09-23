alter table public.customers add column preferences jsonb not null default '{}'::jsonb;
