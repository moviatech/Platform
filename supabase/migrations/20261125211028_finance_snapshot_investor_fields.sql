update public.fin_snapshot_sources set columns = columns || array['kind', 'company_id'] where source_table = 'investors' and not ('kind' = any (columns));
update public.fin_snapshot_sources set columns = columns || array['member_id'] where source_table = 'investor_withdrawals' and not ('member_id' = any (columns));
