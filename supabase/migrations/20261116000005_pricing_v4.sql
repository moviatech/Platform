insert into public.pricing_configs (version, effective_from, data)
select 4, now(), (data - 'protectionChargeCapDays') || jsonb_build_object(
  'protectionPlans', (select jsonb_agg(plan - 'monthlyCents' order by position) from jsonb_array_elements(data -> 'protectionPlans') with ordinality as items(plan, position))
)
from public.pricing_configs
where version = 3
on conflict (version) do nothing;
