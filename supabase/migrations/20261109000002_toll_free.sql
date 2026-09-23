update public.settings
set value = jsonb_set(jsonb_set(value, '{contact,phone}', '"+1 (877) 696-6842"'), '{contact,phoneAlias}', '"877-MY-MOVIA"'), updated_at = now()
where key = 'portal';

update public.settings
set value = jsonb_set(value, '{phone}', '"+1 (877) 696-6842"'), updated_at = now()
where key = 'business';

update public.locations
set support_phone = '+1 (877) 696-6842'
where regexp_replace(coalesce(support_phone, ''), '\D', '', 'g') in ('16263904721', '6263904721');
