update public.fin_snapshot_sources set columns = array_remove(columns, 'memo') where source_table = 'investor_ledger_entries';
update public.fin_snapshot_sources set columns = array_remove(columns, 'bank_reference') where source_table = 'investor_contributions';
update public.fin_snapshot_sources set columns = array_remove(columns, 'paid_reference') where source_table = 'investor_withdrawals';

alter function public.fin_snapshot_source(text) set timezone = 'UTC';

revoke all on table public.fin_job_runs, public.fin_job_lease, public.fin_snapshot_sources, public.fin_source_snapshots from service_role;
grant select, insert, update on table public.fin_job_runs to service_role;
grant select on table public.fin_job_lease, public.fin_snapshot_sources, public.fin_source_snapshots to service_role;

revoke all on sequence public.fin_job_runs_id_seq, public.fin_source_snapshots_id_seq from public, anon, authenticated;
