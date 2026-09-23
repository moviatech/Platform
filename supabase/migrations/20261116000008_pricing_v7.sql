insert into public.pricing_configs (version, effective_from, data)
select 7, now(), data || jsonb_build_object(
  'protectionPlans', '[{"id": "none", "dailyCents": 0, "deductibleCents": null}, {"id": "basic", "dailyCents": 2000, "deductibleCents": 200000}, {"id": "standard", "dailyCents": 3000, "deductibleCents": 50000}, {"id": "premier", "dailyCents": 4000, "deductibleCents": 0}]'::jsonb,
  'protectionSurchargeCents', '{"cybertruck": 500}'::jsonb
)
from public.pricing_configs
where version = 6
on conflict (version) do nothing;
