set lock_timeout = '3s';

create table public.fin_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.fin_accounts (
  code text primary key check (code ~ '^[0-9]{4}$'),
  name_zh text not null,
  name_en text not null,
  kind text not null check (kind in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'COST', 'EXPENSE')),
  export_name text,
  sort integer not null default 0,
  active boolean not null default true
);

create table public.fin_mappings (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('LINE', 'EXPENSE', 'STRIPE', 'OWNER', 'RESOLUTION')),
  match text not null,
  account text references public.fin_accounts (code),
  mode text not null default 'ONCE' check (mode in ('SPREAD', 'ONCE', 'NONE')),
  version integer not null default 1 check (version > 0),
  effective_from date not null default '2026-01-01',
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, match, version),
  check ((mode = 'NONE') = (account is null))
);

create table public.fin_periods (
  book text not null check (book in ('live', 'sandbox')),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  locked_at timestamptz,
  locked_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  snapshot jsonb,
  digest text,
  history jsonb not null default '[]'::jsonb,
  primary key (book, period),
  check (reopened_at is null or locked_at is not null)
);

create table public.fin_journal_entries (
  id bigint generated always as identity primary key,
  book text not null check (book in ('live', 'sandbox')),
  entry_no bigint not null check (entry_no > 0),
  economic_date date not null,
  entry_date date not null,
  adjusts_period text check (adjusts_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_type text not null,
  source_id text not null,
  source_key text not null,
  seq integer not null check (seq > 0),
  rule_version integer not null,
  reason text not null check (reason in ('NEW', 'REPRICE', 'STATUS', 'RULE', 'SOURCE_DELETED', 'CORRECTION', 'MANUAL')),
  inputs jsonb not null default '{}'::jsonb,
  memo text,
  created_by uuid,
  posted_at timestamptz not null default now(),
  unique (book, entry_no),
  unique (book, source_key, seq)
);

create index fin_journal_entries_date_idx on public.fin_journal_entries (book, entry_date);
create index fin_journal_entries_source_idx on public.fin_journal_entries (book, source_type, source_id);

create table public.fin_journal_lines (
  id bigint generated always as identity primary key,
  entry_id bigint not null references public.fin_journal_entries (id) on delete cascade,
  line_no integer not null,
  account text not null references public.fin_accounts (code),
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  reservation_id uuid,
  vehicle_id uuid,
  location_id uuid,
  investor_id uuid,
  expense_id uuid,
  stripe_id text,
  revenue_class text,
  check ((debit_cents = 0) <> (credit_cents = 0)),
  unique (entry_id, line_no)
);

create index fin_journal_lines_account_idx on public.fin_journal_lines (account);
create index fin_journal_lines_reservation_idx on public.fin_journal_lines (reservation_id) where reservation_id is not null;
create index fin_journal_lines_investor_idx on public.fin_journal_lines (investor_id) where investor_id is not null;
create index fin_journal_lines_vehicle_idx on public.fin_journal_lines (vehicle_id) where vehicle_id is not null;

create table public.fin_inclusions (
  object_type text not null check (object_type in ('reservation', 'investor')),
  object_id uuid not null,
  included boolean not null,
  reason text not null check (length(btrim(reason)) > 0),
  set_by uuid,
  set_at timestamptz not null default now(),
  primary key (object_type, object_id)
);

create table public.fin_exceptions (
  id bigint generated always as identity primary key,
  book text not null check (book in ('live', 'sandbox')),
  kind text not null,
  dedupe_key text not null,
  reservation_id uuid,
  investor_id uuid,
  source_key text,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  note text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  unique (book, dedupe_key),
  check ((status = 'RESOLVED') = (resolved_at is not null))
);

create index fin_exceptions_status_idx on public.fin_exceptions (book, status, kind);

create table public.fin_order_resolutions (
  id uuid primary key default gen_random_uuid(),
  book text not null check (book in ('live', 'sandbox')),
  reservation_id uuid not null,
  category text not null check (category in ('INCOME_DAMAGE', 'INCOME_FEES', 'INCOME_OTHER', 'ALLOWANCE', 'BAD_DEBT', 'REFUND_PAYABLE')),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (length(btrim(reason)) > 0),
  evidence_path text,
  created_by uuid not null,
  approved_by uuid,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  check (approved_by is null or approved_by <> created_by),
  check ((voided_at is null) = (void_reason is null)),
  check ((voided_at is null) = (voided_by is null))
);

create index fin_order_resolutions_reservation_idx on public.fin_order_resolutions (book, reservation_id);

create table public.fin_price_reviews (
  reservation_id uuid primary key,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  total_cents bigint not null,
  lines_hash text not null
);

create function public.fin_journal_entries_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.book = 'sandbox' then
      return old;
    end if;
  end if;
  raise exception 'fin_journal_append_only';
end;
$$;

create function public.fin_journal_lines_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_book text;
begin
  if tg_op = 'DELETE' then
    select e.book into v_book from public.fin_journal_entries e where e.id = old.entry_id;
    if not found or v_book = 'sandbox' then
      return old;
    end if;
  end if;
  raise exception 'fin_journal_append_only';
end;
$$;

create function public.fin_order_resolutions_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.approved_by is null and new.voided_at is null and new.voided_by is null and new.void_reason is null then
      return new;
    end if;
    raise exception 'fin_resolutions_append_only';
  end if;
  if tg_op = 'DELETE' then
    if old.book = 'sandbox' then
      return old;
    end if;
    raise exception 'fin_resolutions_append_only';
  end if;
  if tg_op = 'UPDATE'
    and new.id = old.id and new.book = old.book and new.reservation_id = old.reservation_id
    and new.category = old.category and new.amount_cents = old.amount_cents and new.reason = old.reason
    and new.evidence_path is not distinct from old.evidence_path and new.created_by = old.created_by
    and new.created_at = old.created_at then
    if old.voided_at is null and old.approved_by is null and new.approved_by is not null
      and new.voided_at is null and new.voided_by is null and new.void_reason is null then
      return new;
    end if;
    if old.voided_at is null and new.voided_at is not null
      and new.approved_by is not distinct from old.approved_by then
      return new;
    end if;
    if new.approved_by is not distinct from old.approved_by
      and new.voided_at is not distinct from old.voided_at
      and new.voided_by is not distinct from old.voided_by
      and new.void_reason is not distinct from old.void_reason then
      return new;
    end if;
  end if;
  raise exception 'fin_resolutions_append_only';
end;
$$;

create function public.fin_settings_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'fin_settings_protected';
  end if;
  if old.key = 'live_key_hash' then
    raise exception 'fin_settings_protected';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.key = 'live_key_hash' then
    raise exception 'fin_settings_protected';
  end if;
  return new;
end;
$$;

create trigger fin_journal_entries_immutable before update or delete on public.fin_journal_entries
for each row execute function public.fin_journal_entries_guard();

create trigger fin_journal_entries_no_truncate before truncate on public.fin_journal_entries
for each statement execute function public.fin_journal_entries_guard();

create trigger fin_journal_lines_immutable before update or delete on public.fin_journal_lines
for each row execute function public.fin_journal_lines_guard();

create trigger fin_journal_lines_no_truncate before truncate on public.fin_journal_lines
for each statement execute function public.fin_journal_lines_guard();

create trigger fin_order_resolutions_guarded before insert or update or delete on public.fin_order_resolutions
for each row execute function public.fin_order_resolutions_guard();

create trigger fin_order_resolutions_no_truncate before truncate on public.fin_order_resolutions
for each statement execute function public.fin_order_resolutions_guard();

create trigger fin_settings_guarded before update or delete on public.fin_settings
for each row execute function public.fin_settings_guard();

create trigger fin_settings_no_truncate before truncate on public.fin_settings
for each statement execute function public.fin_settings_guard();

create function public.fin_assert_book(p_book text, p_live_key text) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_book is null or p_book not in ('live', 'sandbox') then
    raise exception 'invalid_book';
  end if;
  if p_book = 'live' then
    select s.value #>> '{}' into v_hash from public.fin_settings s where s.key = 'live_key_hash';
    if v_hash is null or p_live_key is null or length(p_live_key) < 32
      or v_hash <> encode(sha256(convert_to(p_live_key, 'UTF8')), 'hex') then
      raise exception 'live_disabled';
    end if;
  end if;
end;
$$;

create function public.fin_enable_live(p_key_hash text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_key_hash';
  end if;
  insert into public.fin_settings (key, value) values ('live_key_hash', to_jsonb(p_key_hash))
  on conflict (key) do nothing;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'live_already_enabled';
  end if;
end;
$$;

create function public.fin_put_cursor(p_book text, p_live_key text, p_name text, p_value jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fin_assert_book(p_book, p_live_key);
  if p_name is null or p_name !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'invalid_cursor_name';
  end if;
  if p_value is null then
    raise exception 'invalid_cursor_value';
  end if;
  insert into public.fin_settings (key, value, updated_at)
  values ('cursor:' || p_book || ':' || p_name, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
end;
$$;

create function public.fin_post_targets(p_book text, p_live_key text, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
  v_key text;
  v_type text;
  v_id text;
  v_econ date;
  v_rule integer;
  v_reason text;
  v_targets jsonb;
  v_inputs jsonb;
  v_sum numeric;
  v_diffs jsonb;
  v_month date;
  v_entry_date date;
  v_adjusts text;
  v_entry_no bigint;
  v_seq integer;
  v_entry_id bigint;
  v_lines integer;
  v_debit numeric;
  v_credit numeric;
begin
  perform public.fin_assert_book(p_book, p_live_key);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too_many_items';
  end if;
  perform pg_advisory_xact_lock(hashtext('fin:seq:' || p_book));

  for v_item in select i.value from jsonb_array_elements(p_items) i loop
    v_key := v_item->>'source_key';
    begin
      if v_key is null or btrim(v_key) = '' then
        raise exception 'invalid_source_key';
      end if;
      v_type := nullif(btrim(v_item->>'source_type'), '');
      v_id := nullif(btrim(v_item->>'source_id'), '');
      if v_type is null or v_id is null then
        raise exception 'invalid_source';
      end if;
      v_econ := (v_item->>'economic_date')::date;
      if v_econ is null then
        raise exception 'invalid_economic_date';
      end if;
      v_rule := (v_item->>'rule_version')::integer;
      if v_rule is null then
        raise exception 'invalid_rule_version';
      end if;
      v_reason := v_item->>'reason';
      if v_reason is null or v_reason not in ('NEW', 'REPRICE', 'STATUS', 'RULE', 'SOURCE_DELETED', 'CORRECTION', 'MANUAL') then
        raise exception 'invalid_reason';
      end if;
      v_targets := v_item->'targets';
      if v_targets is null or jsonb_typeof(v_targets) <> 'array' then
        raise exception 'invalid_targets';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_targets) t
        where jsonb_typeof(t.value) <> 'object'
           or jsonb_typeof(t.value->'amount') is distinct from 'number'
           or (t.value->>'amount') !~ '^-?[0-9]{1,15}$'
           or nullif(t.value->>'account', '') is null
      ) then
        raise exception 'invalid_target';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_targets) t
        where not exists (select 1 from public.fin_accounts a where a.code = t.value->>'account')
      ) then
        raise exception 'unknown_account';
      end if;
      select coalesce(sum((t.value->>'amount')::bigint), 0) into v_sum from jsonb_array_elements(v_targets) t;
      if v_sum <> 0 then
        raise exception 'unbalanced_targets';
      end if;
      v_inputs := case when jsonb_typeof(v_item->'inputs') in ('object', 'array') then v_item->'inputs' else '{}'::jsonb end;

      perform pg_advisory_xact_lock(hashtext('fin:' || p_book || ':' || v_key));

      with wanted as (
        select jsonb_build_object(
                 'account', t.value->>'account',
                 'reservation_id', (nullif(t.value->>'reservation_id', ''))::uuid::text,
                 'vehicle_id', (nullif(t.value->>'vehicle_id', ''))::uuid::text,
                 'location_id', (nullif(t.value->>'location_id', ''))::uuid::text,
                 'investor_id', (nullif(t.value->>'investor_id', ''))::uuid::text,
                 'expense_id', (nullif(t.value->>'expense_id', ''))::uuid::text,
                 'stripe_id', nullif(t.value->>'stripe_id', ''),
                 'revenue_class', nullif(t.value->>'revenue_class', '')
               ) as k,
               sum((t.value->>'amount')::bigint) as amount
        from jsonb_array_elements(v_targets) t
        group by 1
      ),
      posted as (
        select jsonb_build_object(
                 'account', l.account,
                 'reservation_id', l.reservation_id::text,
                 'vehicle_id', l.vehicle_id::text,
                 'location_id', l.location_id::text,
                 'investor_id', l.investor_id::text,
                 'expense_id', l.expense_id::text,
                 'stripe_id', l.stripe_id,
                 'revenue_class', l.revenue_class
               ) as k,
               sum(l.debit_cents - l.credit_cents) as amount
        from public.fin_journal_entries e
        join public.fin_journal_lines l on l.entry_id = e.id
        where e.book = p_book and e.source_key = v_key
        group by 1
      ),
      delta as (
        select coalesce(w.k, d.k) as k, coalesce(w.amount, 0) - coalesce(d.amount, 0) as diff
        from wanted w
        full join posted d on d.k = w.k
      )
      select jsonb_agg(x.k || jsonb_build_object('diff', x.diff) order by x.k->>'account', x.k::text)
      into v_diffs
      from delta x
      where x.diff <> 0;

      if v_diffs is null then
        v_results := v_results || jsonb_build_array(jsonb_build_object('source_key', v_key, 'posted', false, 'entry_no', null, 'entry_date', null, 'adjusts_period', null, 'lines', 0, 'error', null));
      else
        v_month := make_date(extract(year from v_econ)::integer, extract(month from v_econ)::integer, 1);
        while exists (
          select 1 from public.fin_periods f
          where f.book = p_book and f.period = to_char(v_month, 'YYYY-MM') and f.locked_at is not null
            and not (v_reason = 'MANUAL' and f.reopened_at is not null)
        ) loop
          v_month := (v_month + interval '1 month')::date;
        end loop;
        if v_month > v_econ then
          v_entry_date := v_month;
          v_adjusts := to_char(v_econ, 'YYYY-MM');
        else
          v_entry_date := v_econ;
          v_adjusts := null;
        end if;

        select coalesce(max(e.entry_no), 0) + 1 into v_entry_no from public.fin_journal_entries e where e.book = p_book;
        select coalesce(max(e.seq), 0) + 1 into v_seq from public.fin_journal_entries e where e.book = p_book and e.source_key = v_key;

        insert into public.fin_journal_entries (book, entry_no, economic_date, entry_date, adjusts_period, source_type, source_id, source_key, seq, rule_version, reason, inputs, memo, created_by)
        values (p_book, v_entry_no, v_econ, v_entry_date, v_adjusts, v_type, v_id, v_key, v_seq, v_rule, v_reason, v_inputs, nullif(v_item->>'memo', ''), (nullif(v_item->>'created_by', ''))::uuid)
        returning id into v_entry_id;

        insert into public.fin_journal_lines (entry_id, line_no, account, debit_cents, credit_cents, reservation_id, vehicle_id, location_id, investor_id, expense_id, stripe_id, revenue_class)
        select v_entry_id, x.n::integer, x.v->>'account',
               greatest((x.v->>'diff')::bigint, 0), greatest(-((x.v->>'diff')::bigint), 0),
               (x.v->>'reservation_id')::uuid, (x.v->>'vehicle_id')::uuid, (x.v->>'location_id')::uuid,
               (x.v->>'investor_id')::uuid, (x.v->>'expense_id')::uuid, x.v->>'stripe_id', x.v->>'revenue_class'
        from jsonb_array_elements(v_diffs) with ordinality as x(v, n);
        get diagnostics v_lines = row_count;

        select coalesce(sum(l.debit_cents), 0), coalesce(sum(l.credit_cents), 0) into v_debit, v_credit
        from public.fin_journal_lines l where l.entry_id = v_entry_id;
        if v_debit <> v_credit or v_debit = 0 then
          raise exception 'unbalanced_entry';
        end if;

        v_results := v_results || jsonb_build_array(jsonb_build_object('source_key', v_key, 'posted', true, 'entry_no', v_entry_no, 'entry_date', v_entry_date, 'adjusts_period', v_adjusts, 'lines', v_lines, 'error', null));
      end if;
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object('source_key', v_key, 'posted', false, 'entry_no', null, 'entry_date', null, 'adjusts_period', null, 'lines', 0, 'error', sqlerrm));
    end;
  end loop;

  return v_results;
end;
$$;

create function public.fin_add_resolution(p_book text, p_live_key text, p_reservation_id uuid, p_category text, p_amount_cents bigint, p_reason text, p_evidence_path text, p_created_by uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.fin_assert_book(p_book, p_live_key);
  if p_created_by is null then
    raise exception 'created_by_required';
  end if;
  insert into public.fin_order_resolutions (book, reservation_id, category, amount_cents, reason, evidence_path, created_by)
  values (p_book, p_reservation_id, p_category, p_amount_cents, p_reason, nullif(btrim(p_evidence_path), ''), p_created_by)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.fin_approve_resolution(p_book text, p_live_key text, p_id uuid, p_by uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fin_assert_book(p_book, p_live_key);
  update public.fin_order_resolutions r
  set approved_by = p_by
  where r.id = p_id and r.book = p_book and r.approved_by is null and r.voided_at is null and r.created_by <> p_by;
  if not found then
    raise exception 'cannot_approve';
  end if;
end;
$$;

create function public.fin_void_resolution(p_book text, p_live_key text, p_id uuid, p_by uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fin_assert_book(p_book, p_live_key);
  if p_by is null then
    raise exception 'voided_by_required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason_required';
  end if;
  update public.fin_order_resolutions r
  set voided_at = clock_timestamp(), voided_by = p_by, void_reason = p_reason
  where r.id = p_id and r.book = p_book and r.voided_at is null;
  if not found then
    raise exception 'cannot_void';
  end if;
end;
$$;

create function public.fin_sandbox_reset() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entries integer;
  v_exceptions integer;
  v_resolutions integer;
  v_periods integer;
  v_cursors integer;
begin
  perform pg_advisory_xact_lock(hashtext('fin:seq:sandbox'));
  delete from public.fin_journal_entries where book = 'sandbox';
  get diagnostics v_entries = row_count;
  delete from public.fin_exceptions where book = 'sandbox';
  get diagnostics v_exceptions = row_count;
  delete from public.fin_order_resolutions where book = 'sandbox';
  get diagnostics v_resolutions = row_count;
  delete from public.fin_periods where book = 'sandbox';
  get diagnostics v_periods = row_count;
  delete from public.fin_settings where key like 'cursor:sandbox:%';
  get diagnostics v_cursors = row_count;
  return jsonb_build_object('entries', v_entries, 'exceptions', v_exceptions, 'resolutions', v_resolutions, 'periods', v_periods, 'cursors', v_cursors);
end;
$$;

create function public.fin_lock_period(p_book text, p_live_key text, p_period text, p_by uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_row public.fin_periods%rowtype;
  v_from date;
  v_to date;
  v_snapshot jsonb;
  v_digest text;
  v_entries integer;
begin
  perform public.fin_assert_book(p_book, p_live_key);
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_period';
  end if;
  perform pg_advisory_xact_lock(hashtext('fin:seq:' || p_book));
  select * into v_row from public.fin_periods f where f.book = p_book and f.period = p_period;
  if found and v_row.locked_at is not null and v_row.reopened_at is null then
    raise exception 'period_locked';
  end if;
  v_from := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_to := (v_from + interval '1 month')::date;

  select coalesce(jsonb_agg(jsonb_build_object('account', s.account, 'debit', s.debit, 'credit', s.credit) order by s.account), '[]'::jsonb)
  into v_snapshot
  from (
    select l.account, sum(l.debit_cents) as debit, sum(l.credit_cents) as credit
    from public.fin_journal_entries e
    join public.fin_journal_lines l on l.entry_id = e.id
    where e.book = p_book and e.entry_date >= v_from and e.entry_date < v_to
    group by l.account
  ) s;

  select count(distinct e.id)::integer,
         encode(sha256(convert_to(coalesce(string_agg(
           format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
             e.entry_no, l.line_no, to_char(e.entry_date, 'YYYY-MM-DD'), to_char(e.economic_date, 'YYYY-MM-DD'), e.source_key, l.account, l.debit_cents, l.credit_cents,
             coalesce(l.reservation_id::text, '-'), coalesce(l.vehicle_id::text, '-'), coalesce(l.location_id::text, '-'),
             coalesce(l.investor_id::text, '-'), coalesce(l.expense_id::text, '-'), coalesce(l.stripe_id, '-'), coalesce(l.revenue_class, '-')),
           E'\n' order by e.entry_no, l.line_no), ''), 'UTF8')), 'hex')
  into v_entries, v_digest
  from public.fin_journal_entries e
  join public.fin_journal_lines l on l.entry_id = e.id
  where e.book = p_book and e.entry_date >= v_from and e.entry_date < v_to;

  insert into public.fin_periods as f (book, period, locked_at, locked_by, snapshot, digest)
  values (p_book, p_period, clock_timestamp(), p_by, v_snapshot, v_digest)
  on conflict (book, period) do update
    set history = f.history || jsonb_build_array(jsonb_build_object(
          'locked_at', f.locked_at, 'locked_by', f.locked_by, 'digest', f.digest, 'snapshot', f.snapshot,
          'reopened_at', f.reopened_at, 'reopened_by', f.reopened_by, 'reopen_reason', f.reopen_reason)),
        locked_at = excluded.locked_at,
        locked_by = excluded.locked_by,
        snapshot = excluded.snapshot,
        digest = excluded.digest,
        reopened_at = null,
        reopened_by = null,
        reopen_reason = null;

  return jsonb_build_object('book', p_book, 'period', p_period, 'entries', v_entries, 'accounts', jsonb_array_length(v_snapshot), 'digest', v_digest);
end;
$$;

create function public.fin_reopen_period(p_book text, p_live_key text, p_period text, p_by uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fin_assert_book(p_book, p_live_key);
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason_required';
  end if;
  perform pg_advisory_xact_lock(hashtext('fin:seq:' || p_book));
  update public.fin_periods f
  set reopened_at = clock_timestamp(), reopened_by = p_by, reopen_reason = p_reason
  where f.book = p_book and f.period = p_period and f.locked_at is not null and f.reopened_at is null;
  if not found then
    raise exception 'period_not_locked';
  end if;
end;
$$;

create function public.fin_trial_balance(p_book text, p_from date, p_to date)
returns table (account text, debit bigint, credit bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.account, sum(l.debit_cents)::bigint, sum(l.credit_cents)::bigint
  from public.fin_journal_entries e
  join public.fin_journal_lines l on l.entry_id = e.id
  where e.book = p_book
    and (p_from is null or e.entry_date >= p_from)
    and (p_to is null or e.entry_date <= p_to)
  group by l.account
  order by l.account;
$$;

create function public.fin_trial_balance_economic(p_book text, p_from date, p_to date)
returns table (account text, debit bigint, credit bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.account, sum(l.debit_cents)::bigint, sum(l.credit_cents)::bigint
  from public.fin_journal_entries e
  join public.fin_journal_lines l on l.entry_id = e.id
  where e.book = p_book
    and (p_from is null or e.economic_date >= p_from)
    and (p_to is null or e.economic_date <= p_to)
  group by l.account
  order by l.account;
$$;

create function public.fin_order_balances(p_book text, p_as_of date)
returns table (reservation_id uuid, balance bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.reservation_id, sum(l.debit_cents - l.credit_cents)::bigint
  from public.fin_journal_entries e
  join public.fin_journal_lines l on l.entry_id = e.id
  where e.book = p_book and l.account = '1100' and l.reservation_id is not null
    and (p_as_of is null or e.entry_date <= p_as_of)
  group by l.reservation_id;
$$;

create function public.fin_owner_balances(p_book text, p_as_of date)
returns table (investor_id uuid, account text, balance bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.investor_id, l.account, sum(l.credit_cents - l.debit_cents)::bigint
  from public.fin_journal_entries e
  join public.fin_journal_lines l on l.entry_id = e.id
  where e.book = p_book and l.account in ('2200', '2210', '2300', '2310') and l.investor_id is not null
    and (p_as_of is null or e.entry_date <= p_as_of)
  group by l.investor_id, l.account;
$$;

create function public.fin_source_balances(p_book text, p_source_type text, p_key_prefix text)
returns table (source_key text, source_id text, account text, reservation_id uuid, vehicle_id uuid, location_id uuid, investor_id uuid, expense_id uuid, stripe_id text, revenue_class text, balance bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select e.source_key, min(e.source_id), l.account, l.reservation_id, l.vehicle_id, l.location_id, l.investor_id, l.expense_id, l.stripe_id, l.revenue_class,
         sum(l.debit_cents - l.credit_cents)::bigint
  from public.fin_journal_entries e
  join public.fin_journal_lines l on l.entry_id = e.id
  where e.book = p_book
    and (p_source_type is null or e.source_type = p_source_type)
    and (p_key_prefix is null or left(e.source_key, length(p_key_prefix)) = p_key_prefix)
  group by e.source_key, l.account, l.reservation_id, l.vehicle_id, l.location_id, l.investor_id, l.expense_id, l.stripe_id, l.revenue_class
  having sum(l.debit_cents - l.credit_cents) <> 0;
$$;

create function public.fin_exposed_grants()
returns table (object_kind text, object_name text, grantee text, privilege text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.relkind::text, c.relname::text, coalesce(r.rolname::text, 'PUBLIC'), a.privilege_type::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  cross join lateral pg_catalog.aclexplode(c.relacl) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where left(c.relname, 4) = 'fin_' and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  union all
  select 'f', p.proname::text || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')', coalesce(r.rolname::text, 'PUBLIC'), a.privilege_type::text
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where left(p.proname, 4) = 'fin_' and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));
$$;

insert into public.fin_accounts (code, name_zh, name_en, kind, sort) values
  ('1010', '银行存款', 'Bank', 'ASSET', 1010),
  ('1050', 'Stripe 余额', 'Stripe balance', 'ASSET', 1050),
  ('1060', '在途资金（Stripe 打款）', 'Funds in transit (Stripe payouts)', 'ASSET', 1060),
  ('1070', '在途资金（线下收款）', 'Funds in transit (offline receipts)', 'ASSET', 1070),
  ('1080', '待匹配银行', 'Bank clearing', 'ASSET', 1080),
  ('1100', '客户往来', 'Customer accounts', 'ASSET', 1100),
  ('1150', '拒付争议中', 'Disputed funds', 'ASSET', 1150),
  ('2100', '应缴销售税', 'Sales tax payable', 'LIABILITY', 2100),
  ('2190', '无订单收款', 'Unapplied receipts', 'LIABILITY', 2190),
  ('2200', '应付车主（收益）', 'Owner payable (earnings)', 'LIABILITY', 2200),
  ('2210', '应付车主（预提）', 'Owner payable (accrued)', 'LIABILITY', 2210),
  ('2300', '车主资金（未配置）', 'Owner funds (unallocated)', 'LIABILITY', 2300),
  ('2310', '车主资金（已配置）', 'Owner funds (allocated)', 'LIABILITY', 2310),
  ('2400', '代扣税款', 'Tax withheld', 'LIABILITY', 2400),
  ('2900', '待处理挂账', 'Suspense', 'LIABILITY', 2900),
  ('2910', '测试订单往来', 'Test order clearing', 'LIABILITY', 2910),
  ('2920', '应退客户款', 'Refunds payable', 'LIABILITY', 2920),
  ('3010', '股东投入', 'Shareholder contributions', 'EQUITY', 3010),
  ('3900', '留存收益', 'Retained earnings', 'EQUITY', 3900),
  ('4010', '租金收入', 'Rental revenue', 'REVENUE', 4010),
  ('4020', '保障方案收入', 'Protection revenue', 'REVENUE', 4020),
  ('4030', '附加服务收入', 'Add-on revenue', 'REVENUE', 4030),
  ('4040', '送车费收入', 'Delivery revenue', 'REVENUE', 4040),
  ('4050', '还车后费用收入', 'Post-return fee revenue', 'REVENUE', 4050),
  ('4060', '代垫回收', 'Pass-through recoveries', 'REVENUE', 4060),
  ('4065', '过路费手续费收入', 'Toll admin fee revenue', 'REVENUE', 4065),
  ('4070', '取消费与未到店费收入', 'Cancellation and no-show fees', 'REVENUE', 4070),
  ('4080', '车损回收', 'Damage recoveries', 'REVENUE', 4080),
  ('4090', '其他收入', 'Other revenue', 'REVENUE', 4090),
  ('4910', '提前付款折扣', 'Pay-now discounts', 'CONTRA_REVENUE', 4910),
  ('4920', '优惠码（公司承担）', 'Coupons (company-funded)', 'CONTRA_REVENUE', 4920),
  ('4925', '优惠码（车主共担）', 'Coupons (owner-shared)', 'CONTRA_REVENUE', 4925),
  ('4930', '手工折扣', 'Manual discounts', 'CONTRA_REVENUE', 4930),
  ('4940', '让利', 'Allowances', 'CONTRA_REVENUE', 4940),
  ('5010', '车主分成（托管车辆）', 'Owner revenue share (managed vehicles)', 'COST', 5010),
  ('5015', '车主回报（资金投入）', 'Owner returns (capital)', 'COST', 5015),
  ('5020', '车主里程费', 'Owner mileage fees', 'COST', 5020),
  ('5030', 'Stripe 手续费', 'Stripe fees', 'COST', 5030),
  ('5040', '拒付损失', 'Chargeback losses', 'COST', 5040),
  ('5045', '拒付手续费', 'Chargeback fees', 'COST', 5045),
  ('5050', '坏账损失', 'Bad debt', 'COST', 5050),
  ('6010', '充电', 'Charging', 'EXPENSE', 6010),
  ('6020', '清洁整备', 'Cleaning and prep', 'EXPENSE', 6020),
  ('6030', '保险', 'Insurance', 'EXPENSE', 6030),
  ('6040', '注册与牌照', 'Registration and plates', 'EXPENSE', 6040),
  ('6050', '维修保养', 'Maintenance and repairs', 'EXPENSE', 6050),
  ('6060', '过路费与罚单', 'Tolls and tickets', 'EXPENSE', 6060),
  ('6070', '停车与场地', 'Parking and storage', 'EXPENSE', 6070),
  ('6080', '车辆贷款与租赁', 'Vehicle loans and leases', 'EXPENSE', 6080),
  ('6090', '其他支付手续费', 'Other payment fees', 'EXPENSE', 6090),
  ('6100', '市场推广', 'Marketing', 'EXPENSE', 6100),
  ('6110', '软件与服务', 'Software and services', 'EXPENSE', 6110),
  ('6120', '人工', 'Payroll', 'EXPENSE', 6120),
  ('6130', '房租', 'Rent', 'EXPENSE', 6130),
  ('6900', '其他费用', 'Other expenses', 'EXPENSE', 6900);

insert into public.fin_mappings (kind, match, account, mode) values
  ('LINE', 'RENTAL/*', '4010', 'SPREAD'),
  ('LINE', 'PROTECTION/*', '4020', 'SPREAD'),
  ('LINE', 'ADD_ON/addon.childSeat', null, 'NONE'),
  ('LINE', 'ADD_ON/*', '4030', 'SPREAD'),
  ('LINE', 'YOUNG_DRIVER/*', '4030', 'SPREAD'),
  ('LINE', 'DELIVERY/*', '4040', 'ONCE'),
  ('LINE', 'DISCOUNT/discount.pay_now', '4910', 'SPREAD'),
  ('LINE', 'DISCOUNT/discount.coupon_company', '4920', 'SPREAD'),
  ('LINE', 'DISCOUNT/discount.coupon', '4925', 'SPREAD'),
  ('LINE', 'DISCOUNT/manual.discount', '4930', 'SPREAD'),
  ('LINE', 'TAX/*', '2100', 'ONCE'),
  ('LINE', 'ADDITIONAL/fee.tax', '2100', 'ONCE'),
  ('LINE', 'ADDITIONAL/fee.supercharging', '4060', 'ONCE'),
  ('LINE', 'ADDITIONAL/fee.*', '4050', 'ONCE'),
  ('LINE', 'ADDITIONAL/charge.toll', '4060', 'ONCE'),
  ('LINE', 'ADDITIONAL/charge.cancellation', '4070', 'ONCE'),
  ('LINE', 'ADDITIONAL/charge.additional', '4090', 'ONCE'),
  ('LINE', 'ADDITIONAL/manual.fee', '4090', 'ONCE'),
  ('EXPENSE', 'CHARGING', '6010', 'ONCE'),
  ('EXPENSE', 'CLEANING', '6020', 'ONCE'),
  ('EXPENSE', 'INSURANCE', '6030', 'ONCE'),
  ('EXPENSE', 'REGISTRATION', '6040', 'ONCE'),
  ('EXPENSE', 'MAINTENANCE', '6050', 'ONCE'),
  ('EXPENSE', 'TOLLS_TICKETS', '6060', 'ONCE'),
  ('EXPENSE', 'PARKING', '6070', 'ONCE'),
  ('EXPENSE', 'VEHICLE_FINANCE', '6080', 'ONCE'),
  ('EXPENSE', 'PAYMENT_FEES', '6090', 'ONCE'),
  ('EXPENSE', 'MARKETING', '6100', 'ONCE'),
  ('EXPENSE', 'SOFTWARE', '6110', 'ONCE'),
  ('EXPENSE', 'PAYROLL', '6120', 'ONCE'),
  ('EXPENSE', 'RENT', '6130', 'ONCE'),
  ('EXPENSE', 'OTHER', '6900', 'ONCE');

alter table public.fin_settings enable row level security;
alter table public.fin_accounts enable row level security;
alter table public.fin_mappings enable row level security;
alter table public.fin_periods enable row level security;
alter table public.fin_journal_entries enable row level security;
alter table public.fin_journal_lines enable row level security;
alter table public.fin_inclusions enable row level security;
alter table public.fin_exceptions enable row level security;
alter table public.fin_order_resolutions enable row level security;
alter table public.fin_price_reviews enable row level security;

revoke all on table public.fin_settings, public.fin_accounts, public.fin_mappings, public.fin_periods, public.fin_journal_entries, public.fin_journal_lines, public.fin_inclusions, public.fin_exceptions, public.fin_order_resolutions, public.fin_price_reviews from public, anon, authenticated, service_role;
grant select on table public.fin_settings, public.fin_accounts, public.fin_mappings, public.fin_periods, public.fin_journal_entries, public.fin_journal_lines, public.fin_order_resolutions to service_role;
grant select, insert, update on table public.fin_exceptions to service_role;
grant select, insert, update, delete on table public.fin_inclusions, public.fin_price_reviews to service_role;

revoke all on sequence public.fin_mappings_id_seq, public.fin_journal_entries_id_seq, public.fin_journal_lines_id_seq, public.fin_exceptions_id_seq from public, anon, authenticated, service_role;

revoke all on function public.fin_journal_entries_guard() from public, anon, authenticated, service_role;
revoke all on function public.fin_journal_lines_guard() from public, anon, authenticated, service_role;
revoke all on function public.fin_order_resolutions_guard() from public, anon, authenticated, service_role;
revoke all on function public.fin_settings_guard() from public, anon, authenticated, service_role;
revoke all on function public.fin_assert_book(text, text) from public, anon, authenticated, service_role;
revoke all on function public.fin_enable_live(text) from public, anon, authenticated, service_role;
revoke all on function public.fin_put_cursor(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fin_post_targets(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fin_add_resolution(text, text, uuid, text, bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function public.fin_approve_resolution(text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fin_void_resolution(text, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fin_sandbox_reset() from public, anon, authenticated;
revoke all on function public.fin_lock_period(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.fin_reopen_period(text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.fin_trial_balance(text, date, date) from public, anon, authenticated;
revoke all on function public.fin_trial_balance_economic(text, date, date) from public, anon, authenticated;
revoke all on function public.fin_order_balances(text, date) from public, anon, authenticated;
revoke all on function public.fin_owner_balances(text, date) from public, anon, authenticated;
revoke all on function public.fin_source_balances(text, text, text) from public, anon, authenticated;
revoke all on function public.fin_exposed_grants() from public, anon, authenticated;

grant execute on function public.fin_put_cursor(text, text, text, jsonb) to service_role;
grant execute on function public.fin_post_targets(text, text, jsonb) to service_role;
grant execute on function public.fin_add_resolution(text, text, uuid, text, bigint, text, text, uuid) to service_role;
grant execute on function public.fin_approve_resolution(text, text, uuid, uuid) to service_role;
grant execute on function public.fin_void_resolution(text, text, uuid, uuid, text) to service_role;
grant execute on function public.fin_sandbox_reset() to service_role;
grant execute on function public.fin_lock_period(text, text, text, uuid) to service_role;
grant execute on function public.fin_reopen_period(text, text, text, uuid, text) to service_role;
grant execute on function public.fin_trial_balance(text, date, date) to service_role;
grant execute on function public.fin_trial_balance_economic(text, date, date) to service_role;
grant execute on function public.fin_order_balances(text, date) to service_role;
grant execute on function public.fin_owner_balances(text, date) to service_role;
grant execute on function public.fin_source_balances(text, text, text) to service_role;
grant execute on function public.fin_exposed_grants() to service_role;
