alter table public.conversations add column if not exists ai_summary jsonb, add column if not exists ai_summary_at timestamptz;
