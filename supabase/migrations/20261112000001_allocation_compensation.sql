alter table public.investor_allocations add column compensation public.investor_compensation not null default 'REVENUE_SHARE';

update public.investor_allocations a
set compensation = i.compensation
from public.investors i
where i.id = a.investor_id;
