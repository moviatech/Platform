create unique index marketing_ai_runs_open_idx on public.marketing_ai_runs (scope, task) where finished_at is null;
