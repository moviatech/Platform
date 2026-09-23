insert into public.pricing_configs (version, effective_from, data)
select 5, now(), jsonb_set(data, '{mileage,excessRateCents}', (data -> 'mileage' -> 'excessRateCents') || '{"model-3": 80, "model-y": 80}'::jsonb)
from public.pricing_configs
where version = 4
on conflict (version) do nothing;
