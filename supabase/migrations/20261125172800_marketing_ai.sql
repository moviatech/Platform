create table public.marketing_ai_runs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (char_length(scope) <= 240),
  task text not null check (char_length(task) <= 40),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  error text,
  input_chars integer not null default 0,
  output_chars integer not null default 0,
  actor uuid,
  actor_name text
);

create index marketing_ai_runs_started_idx on public.marketing_ai_runs (started_at desc);
create index marketing_ai_runs_scope_idx on public.marketing_ai_runs (scope, started_at desc);

create table public.marketing_ai_outputs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (char_length(scope) <= 240),
  task text not null check (char_length(task) <= 40),
  key text not null check (char_length(key) <= 200),
  facts jsonb not null default '{}'::jsonb,
  content jsonb not null,
  flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  unique (scope, task, key)
);

alter table public.marketing_ai_runs enable row level security;
alter table public.marketing_ai_outputs enable row level security;

revoke all on public.marketing_ai_runs, public.marketing_ai_outputs from public, anon, authenticated;
grant all on public.marketing_ai_runs, public.marketing_ai_outputs to service_role;
