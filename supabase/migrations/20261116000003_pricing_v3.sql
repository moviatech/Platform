insert into public.pricing_configs (version, effective_from, data)
select 3, now(), data || jsonb_build_object(
  'mileage', jsonb_set(data -> 'mileage', '{allowance}', jsonb_build_object('daily', 150, 'weekly', 1050, 'monthly', 4500)),
  'rateTiers', '[{"id": "monthly", "minDays": 30, "multiplierBps": 7500}, {"id": "weekly", "minDays": 7, "multiplierBps": 9000}, {"id": "daily", "minDays": 1, "multiplierBps": 10000}]'::jsonb
)
from public.pricing_configs
where version = 2
on conflict (version) do nothing;

update public.conversations set ai_summary_at = null where ai_summary is null and ai_summary_at is not null;
