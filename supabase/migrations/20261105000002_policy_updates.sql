alter table public.vehicle_classes drop constraint vehicle_classes_model_check;
alter table public.vehicle_classes add constraint vehicle_classes_model_check check (model in ('model-3', 'model-y', 'cybertruck'));

insert into public.vehicle_classes (slug, name, name_zh, model, base_daily_rate_cents, security_hold_cents, seats, range_miles, sort_order)
values ('model-3', 'Model 3', 'Model 3', 'model-3', 8900, 50000, 5, 300, 5)
on conflict (slug) do nothing;

insert into public.pricing_configs (version, effective_from, data)
select 2, now(), data || jsonb_build_object(
  'mileage', jsonb_build_object('allowance', jsonb_build_object('daily', 100, 'weekly', 700, 'monthly', 3000), 'excessRateCents', jsonb_build_object('model-3', 99, 'model-y', 99, 'cybertruck', 149)),
  'cancelPolicy', jsonb_set(data -> 'cancelPolicy', '{monthly,feeCents}', '7500'::jsonb),
  'addOns', (data -> 'addOns') || '[{"id": "toll", "kind": "perDay", "priceCents": 1695}]'::jsonb,
  'lateReturn', jsonb_build_object('hourlyCapHours', 5),
  'tolls', jsonb_build_object('adminFeeCentsPerDay', 1295)
)
from public.pricing_configs
where version = 1
on conflict (version) do nothing;

alter table public.reservations add column return_reminder_at timestamptz, add column overdue_notice_at timestamptz;
alter table public.payments add column offline_method text;
