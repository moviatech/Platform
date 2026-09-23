create table public.fin_ai_runs (
  id bigint generated always as identity primary key,
  purpose text not null check (purpose in ('expense_suggest')),
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'PENDING' check (status in ('PENDING', 'OK', 'INVALID', 'FAILED', 'LIMITED')),
  requested_by uuid references public.staff_members (user_id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index fin_ai_runs_month_idx on public.fin_ai_runs (month, created_at desc);

create function public.fin_ai_runs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'fin_ai_runs_append_only';
  end if;
  if new.id = old.id and new.purpose = old.purpose and new.month = old.month and new.created_at = old.created_at
    and (new.requested_by is not distinct from old.requested_by or new.requested_by is null)
    and (old.status = 'PENDING' or (new.status = old.status and new.detail = old.detail and new.finished_at is not distinct from old.finished_at)) then
    return new;
  end if;
  raise exception 'fin_ai_runs_append_only';
end;
$$;

create trigger fin_ai_runs_immutable before update or delete on public.fin_ai_runs
for each row execute function public.fin_ai_runs_guard();

create function public.fin_ai_reserve(p_purpose text, p_month text, p_cap integer, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('fin_ai_runs'));
  if exists (select 1 from public.fin_ai_runs r where r.status = 'LIMITED' and r.created_at > now() - interval '10 minutes') then
    return jsonb_build_object('state', 'paused');
  end if;
  select count(*) into v_used from public.fin_ai_runs r where r.month = p_month;
  if v_used >= p_cap then
    return jsonb_build_object('state', 'capped', 'used', v_used);
  end if;
  insert into public.fin_ai_runs (purpose, month, requested_by) values (p_purpose, p_month, p_user) returning id into v_id;
  return jsonb_build_object('state', 'ok', 'id', v_id, 'used', v_used + 1);
end;
$$;

alter table public.fin_ai_runs enable row level security;
revoke all on table public.fin_ai_runs from public, anon, authenticated, service_role;
grant select, update on table public.fin_ai_runs to service_role;
revoke all on sequence public.fin_ai_runs_id_seq from public, anon, authenticated, service_role;

revoke all on function public.fin_ai_runs_guard() from public, anon, authenticated, service_role;
revoke all on function public.fin_ai_reserve(text, text, integer, uuid) from public, anon, authenticated;
