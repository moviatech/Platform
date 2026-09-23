create function public.fin_snapshot_counts()
returns table (source_table text, snapshots bigint, table_rows bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source record;
begin
  for v_source in select s.source_table as name from public.fin_snapshot_sources s where s.enabled order by s.source_table loop
    source_table := v_source.name;
    execute format('select count(*) from public.%I', v_source.name) into table_rows;
    select count(*) into snapshots
    from (
      select distinct on (f.source_id) f.deleted
      from public.fin_source_snapshots f
      where f.source_table = v_source.name
      order by f.source_id, f.id desc
    ) latest
    where not latest.deleted;
    return next;
  end loop;
end;
$$;

revoke all on function public.fin_snapshot_counts() from public, anon, authenticated;
grant execute on function public.fin_snapshot_counts() to service_role;

revoke all on function public.fin_append_only() from service_role;
revoke all on sequence public.fin_job_runs_id_seq, public.fin_source_snapshots_id_seq from service_role;
