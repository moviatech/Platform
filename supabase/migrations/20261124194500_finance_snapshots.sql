create table public.fin_job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  counts jsonb not null default '{}'::jsonb,
  error text
);

create index fin_job_runs_job_idx on public.fin_job_runs (job, started_at desc);

create table public.fin_job_lease (
  job text primary key,
  holder uuid not null,
  expires_at timestamptz not null
);

create table public.fin_snapshot_sources (
  source_table text primary key,
  id_column text not null default 'id',
  columns text[] not null,
  enabled boolean not null default true
);

create table public.fin_source_snapshots (
  id bigint generated always as identity primary key,
  source_table text not null,
  source_id text not null,
  captured_at timestamptz not null default now(),
  fields jsonb not null,
  hash text not null,
  deleted boolean not null default false
);

create index fin_source_snapshots_lookup_idx on public.fin_source_snapshots (source_table, source_id, id desc);

create function public.fin_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%_append_only', tg_table_name;
end;
$$;

create trigger fin_source_snapshots_immutable before update or delete on public.fin_source_snapshots
for each row execute function public.fin_append_only();

create trigger fin_source_snapshots_no_truncate before truncate on public.fin_source_snapshots
for each statement execute function public.fin_append_only();

create function public.fin_take_lease(p_job text, p_holder uuid, p_seconds integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken boolean;
begin
  insert into public.fin_job_lease (job, holder, expires_at)
  values (p_job, p_holder, now() + make_interval(secs => p_seconds))
  on conflict (job) do update set holder = excluded.holder, expires_at = excluded.expires_at
  where public.fin_job_lease.expires_at < now()
  returning true into v_taken;
  return coalesce(v_taken, false);
end;
$$;

create function public.fin_release_lease(p_job text, p_holder uuid) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.fin_job_lease where job = p_job and holder = p_holder;
$$;

create function public.fin_snapshot_source(p_table text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.fin_snapshot_sources%rowtype;
  v_changed integer := 0;
  v_deleted integer := 0;
begin
  select * into v_source from public.fin_snapshot_sources where source_table = p_table and enabled;
  if not found then
    raise exception 'unknown_source';
  end if;
  perform pg_advisory_xact_lock(hashtext('fin:snapshot:' || p_table));

  execute format(
    $f$
    with current_rows as (
      select t.%1$I::text as source_id,
             (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(to_jsonb(t)) e where e.key = any($1)) as fields
      from public.%2$I t
    ),
    latest as (
      select distinct on (s.source_id) s.source_id, s.hash, s.deleted
      from public.fin_source_snapshots s
      where s.source_table = $2
      order by s.source_id, s.id desc
    ),
    inserted as (
      insert into public.fin_source_snapshots (source_table, source_id, fields, hash)
      select $2, c.source_id, c.fields, md5(c.fields::text)
      from current_rows c
      left join latest l on l.source_id = c.source_id
      where l.source_id is null or l.deleted or l.hash <> md5(c.fields::text)
      returning 1
    )
    select count(*)::integer from inserted
    $f$,
    v_source.id_column,
    p_table
  )
  into v_changed
  using v_source.columns, p_table;

  execute format(
    $f$
    with current_ids as (
      select t.%1$I::text as source_id from public.%2$I t
    ),
    latest as (
      select distinct on (s.source_id) s.source_id, s.deleted
      from public.fin_source_snapshots s
      where s.source_table = $1
      order by s.source_id, s.id desc
    ),
    inserted as (
      insert into public.fin_source_snapshots (source_table, source_id, fields, hash, deleted)
      select $1, l.source_id, '{}'::jsonb, md5('{}'), true
      from latest l
      where not l.deleted
        and not exists (select 1 from current_ids c where c.source_id = l.source_id)
      returning 1
    )
    select count(*)::integer from inserted
    $f$,
    v_source.id_column,
    p_table
  )
  into v_deleted
  using p_table;

  return jsonb_build_object('changed', v_changed, 'deleted', v_deleted);
end;
$$;

insert into public.fin_snapshot_sources (source_table, columns) values
  ('reservations', array['id', 'number', 'status', 'customer_id', 'class_id', 'assigned_vehicle_id', 'pickup_location_id', 'return_location_id', 'pickup_at', 'return_at', 'actual_pickup_at', 'actual_return_at', 'completed_at', 'cancelled_at', 'rental_days', 'rate_plan', 'pickup_method', 'protection', 'add_ons', 'driver_age_band', 'payment_state', 'hold_state', 'subtotal_cents', 'discount_cents', 'tax_cents', 'total_cents', 'taxable_cents', 'tax_rate_bps', 'security_hold_cents', 'pricing_config_id', 'coupon_id', 'booking_source', 'start_odometer', 'end_odometer', 'toll_pending', 'extra_drivers', 'spouse_driver', 'quote_snapshot', 'policy_snapshot', 'created_at']),
  ('reservation_line_items', array['id', 'reservation_id', 'type', 'code', 'description', 'quantity', 'unit_cents', 'amount_cents', 'taxable', 'sort_order', 'created_at']),
  ('payments', array['id', 'reservation_id', 'customer_id', 'kind', 'status', 'amount_cents', 'amount_captured_cents', 'amount_refunded_cents', 'currency', 'description', 'offline_method', 'stripe_payment_intent_id', 'stripe_checkout_session_id', 'stripe_setup_intent_id', 'authorization_expires_at', 'failure_code', 'created_by', 'created_at']),
  ('refunds', array['id', 'payment_id', 'amount_cents', 'reason', 'status', 'stripe_refund_id', 'offline_method', 'created_by', 'created_at']),
  ('damage_claims', array['id', 'reservation_id', 'customer_id', 'amount_cents', 'status', 'payment_id', 'consent_at', 'created_at']),
  ('investors', array['id', 'investor_number', 'status', 'compensation', 'house', 'default_share_bps', 'mileage_payout_days']),
  ('investor_allocations', array['id', 'investor_id', 'vehicle_id', 'contribution_id', 'source', 'share_bps', 'revenue_share_bps', 'cost_basis_cents', 'effective_from', 'effective_to', 'status', 'compensation', 'created_at']),
  ('investor_ledger_entries', array['id', 'investor_id', 'type', 'bucket', 'amount_cents', 'settles_at', 'settled_at', 'reservation_id', 'vehicle_id', 'allocation_id', 'contribution_id', 'withdrawal_id', 'reversal_of', 'statement_id', 'memo', 'metadata', 'created_by', 'created_at']),
  ('investor_withdrawals', array['id', 'investor_id', 'bank_account_id', 'amount_cents', 'status', 'kind', 'approval_id', 'reviewed_by', 'reviewed_at', 'paid_by', 'paid_reference', 'paid_at', 'created_at']),
  ('investor_contributions', array['id', 'investor_id', 'kind', 'status', 'amount_cents', 'received_cents', 'bank_reference', 'decided_by', 'decided_at', 'created_at']),
  ('investor_mileage_statements', array['id', 'investor_id', 'allocation_id', 'vehicle_id', 'month', 'period_start', 'period_end', 'start_reading', 'end_reading', 'adjustment_miles', 'qualifying_miles', 'rate_cents', 'amount_cents', 'status', 'final', 'issued_at', 'disputed_miles', 'accepted_miles', 'entry_id', 'disputed_entry_id']),
  ('vehicles', array['id', 'class_id', 'location_id', 'fleet_number', 'vin', 'license_plate', 'year', 'condition', 'is_placeholder', 'created_at']),
  ('vehicle_classes', array['id', 'slug', 'model', 'base_daily_rate_cents', 'security_hold_cents', 'active']),
  ('vehicle_service_logs', array['id', 'vehicle_id', 'kind', 'performed_on', 'odometer', 'cost_cents', 'vendor', 'created_by', 'created_at']),
  ('locations', array['id', 'code', 'name', 'timezone', 'tax_rate_bps', 'active', 'web_booking']),
  ('coupons', array['id', 'code', 'kind', 'percent_bps', 'amount_cents', 'max_discount_cents', 'bearer', 'stackable', 'active', 'valid_from', 'valid_to']);

alter table public.fin_job_runs enable row level security;
alter table public.fin_job_lease enable row level security;
alter table public.fin_snapshot_sources enable row level security;
alter table public.fin_source_snapshots enable row level security;

revoke all on table public.fin_job_runs, public.fin_job_lease, public.fin_snapshot_sources, public.fin_source_snapshots from public, anon, authenticated;
grant select, insert, update on table public.fin_job_runs to service_role;
grant select on table public.fin_job_lease, public.fin_snapshot_sources, public.fin_source_snapshots to service_role;

revoke all on function public.fin_append_only() from public, anon, authenticated;
revoke all on function public.fin_take_lease(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.fin_release_lease(text, uuid) from public, anon, authenticated;
revoke all on function public.fin_snapshot_source(text) from public, anon, authenticated;
grant execute on function public.fin_take_lease(text, uuid, integer) to service_role;
grant execute on function public.fin_release_lease(text, uuid) to service_role;
grant execute on function public.fin_snapshot_source(text) to service_role;
