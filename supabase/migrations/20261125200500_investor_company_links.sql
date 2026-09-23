alter table public.investor_withdrawals drop constraint investor_withdrawals_member_id_fkey;
alter table public.investor_bank_accounts drop constraint investor_bank_accounts_requested_by_fkey;
alter table public.investor_bank_accounts drop constraint investor_bank_accounts_removal_requested_by_fkey;

create function public.investor_member_link_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_member uuid;
begin
  if tg_table_name = 'investor_withdrawals' then
    v_member := new.member_id;
    if v_member is not null and not exists (select 1 from public.investors m where m.id = v_member and m.company_id = new.investor_id) then
      raise exception 'investor_member_mismatch';
    end if;
  else
    v_member := new.requested_by;
    if v_member is not null and not exists (select 1 from public.investors m where m.id = v_member and m.company_id = new.investor_id) then
      raise exception 'investor_member_mismatch';
    end if;
    v_member := new.removal_requested_by;
    if v_member is not null and not exists (select 1 from public.investors m where m.id = v_member and m.company_id = new.investor_id) then
      raise exception 'investor_member_mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger investor_withdrawals_member_link before insert or update of member_id on public.investor_withdrawals
for each row execute function public.investor_member_link_guard();

create trigger investor_bank_accounts_member_link before insert or update of requested_by, removal_requested_by on public.investor_bank_accounts
for each row execute function public.investor_member_link_guard();
