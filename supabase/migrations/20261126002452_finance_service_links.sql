alter table public.expenses
  add column service_log_id uuid references public.vehicle_service_logs (id) on delete set null;

create unique index expenses_service_log_live_idx on public.expenses (service_log_id) where service_log_id is not null and voided_at is null;

create table public.fin_service_log_skips (
  service_log_id uuid primary key references public.vehicle_service_logs (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  skipped_by uuid references public.staff_members (user_id) on delete set null,
  skipped_at timestamptz not null default now()
);

alter table public.fin_service_log_skips enable row level security;
revoke all on table public.fin_service_log_skips from public, anon, authenticated, service_role;
grant select, insert on table public.fin_service_log_skips to service_role;

revoke truncate on table public.expenses, public.expense_receipts from service_role;

create function public.fin_report_due(p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'service', (
      select count(*)
      from public.vehicle_service_logs s
      join public.vehicles v on v.id = s.vehicle_id
      left join public.vehicle_classes c on c.id = v.class_id
      where s.cost_cents > 0
        and not public.fin_is_test_vehicle(c.slug, v.fleet_number, v.is_placeholder)
        and not exists (select 1 from public.expenses e where e.service_log_id = s.id and e.voided_at is null)
        and not exists (select 1 from public.fin_service_log_skips k where k.service_log_id = s.id)
    ),
    'recurring', (
      select count(*)
      from public.fin_recurring r
      cross join lateral generate_series(0, 1199) g(k)
      cross join lateral (select (r.starts_on + make_interval(months => g.k * r.every_months))::date as due_on) d
      where d.due_on <= p_today
        and (r.ends_on is null or d.due_on <= r.ends_on)
        and not exists (select 1 from public.expenses e where e.recurring_id = r.id and e.recurring_on = d.due_on and e.voided_at is null)
        and not exists (select 1 from public.fin_recurring_skips k where k.recurring_id = r.id and k.due_on = d.due_on)
    )
  );
$$;

revoke all on function public.fin_report_due(date) from public, anon, authenticated;
