alter table public.expenses add column paid_from text not null default 'COMPANY_ACCOUNT' check (paid_from in ('COMPANY_ACCOUNT', 'COMPANY_CARD', 'PERSONAL'));
alter table public.expenses add constraint expenses_capital_period check (not (capital and service_from is not null));

insert into public.fin_accounts (code, name_zh, name_en, kind, sort) values
  ('1200', '预付费用', 'Prepaid expenses', 'ASSET', 1200),
  ('1500', '车辆与设备', 'Vehicles and equipment', 'ASSET', 1500),
  ('2050', '公司信用卡', 'Company credit card', 'LIABILITY', 2050),
  ('2500', '应付股东（个人垫付）', 'Due to shareholder (paid personally)', 'LIABILITY', 2500)
on conflict (code) do nothing;

create or replace function public.expenses_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'expenses_append_only';
  end if;
  if old.voided_at is null and new.voided_at is not null
    and new.id = old.id and new.spent_on = old.spent_on and new.category = old.category and new.amount_cents = old.amount_cents
    and new.vendor is not distinct from old.vendor and new.method = old.method
    and new.reference is not distinct from old.reference and new.note is not distinct from old.note
    and new.created_at = old.created_at
    and new.location_id is not distinct from old.location_id and new.service_from is not distinct from old.service_from
    and new.service_to is not distinct from old.service_to and new.capital = old.capital and new.paid_from = old.paid_from then
    return new;
  end if;
  if new.voided_at is not distinct from old.voided_at and new.void_reason is not distinct from old.void_reason
    and new.id = old.id and new.spent_on = old.spent_on and new.category = old.category and new.amount_cents = old.amount_cents
    and new.vendor is not distinct from old.vendor and new.method = old.method
    and new.reference is not distinct from old.reference and new.note is not distinct from old.note
    and new.created_at = old.created_at
    and new.location_id is not distinct from old.location_id and new.service_from is not distinct from old.service_from
    and new.service_to is not distinct from old.service_to and new.capital = old.capital and new.paid_from = old.paid_from then
    return new;
  end if;
  raise exception 'expenses_append_only';
end;
$$;
