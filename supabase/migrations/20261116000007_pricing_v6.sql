insert into public.pricing_configs (version, effective_from, data)
select 6, now(), jsonb_set(data, '{mileage,excessRateCents,cybertruck}', '120'::jsonb)
from public.pricing_configs
where version = 5
on conflict (version) do nothing;
