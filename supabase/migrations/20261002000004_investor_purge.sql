create function public.investor_purge(p_investor_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  alter table public.investor_ledger_entries disable trigger investor_ledger_immutable;
  delete from public.notifications where investor_id = p_investor_id;
  update public.conversations set investor_id = null where investor_id = p_investor_id;
  delete from public.investor_settlement_holds where investor_id = p_investor_id
    or entry_id in (select id from public.investor_ledger_entries where investor_id = p_investor_id)
    or vehicle_id in (select vehicle_id from public.investor_allocations where investor_id = p_investor_id);
  delete from public.approvals where investor_withdrawal_id in (select id from public.investor_withdrawals where investor_id = p_investor_id);
  delete from public.investor_ledger_entries where investor_id = p_investor_id;
  delete from public.investor_withdrawals where investor_id = p_investor_id;
  delete from public.investor_bank_accounts where investor_id = p_investor_id;
  delete from public.investor_exit_requests where investor_id = p_investor_id;
  delete from public.investor_documents where investor_id = p_investor_id;
  delete from public.investor_allocations where investor_id = p_investor_id;
  delete from public.investor_contributions where investor_id = p_investor_id;
  delete from public.investors where id = p_investor_id;
  alter table public.investor_ledger_entries enable trigger investor_ledger_immutable;
end;
$$;

revoke all on function public.investor_purge(uuid) from public, anon, authenticated;
grant execute on function public.investor_purge(uuid) to service_role;
