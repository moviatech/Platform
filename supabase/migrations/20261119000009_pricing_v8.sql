insert into public.pricing_configs (version, effective_from, data)
select 8, now(), data || jsonb_build_object(
  'protectionPlans', '[{"id": "none", "dailyCents": 0, "deductibleCents": null}, {"id": "basic", "dailyCents": 3000, "deductibleCents": null}, {"id": "standard", "dailyCents": 5000, "deductibleCents": 200000}, {"id": "premier", "dailyCents": 7000, "deductibleCents": 0}]'::jsonb,
  'protectionSurchargeCents', '{"cybertruck": 500}'::jsonb
)
from public.pricing_configs
where version = 7
on conflict (version) do nothing;
