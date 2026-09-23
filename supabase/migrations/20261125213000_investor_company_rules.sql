create or replace function public.investor_member_ratio(p_member uuid, p_on date) returns numeric
language sql
stable
set search_path = ''
as $$
  with live as (
    select s.member_id, s.amount_cents, s.effective_on
    from public.investor_stakes s
    where s.company_id = (select company_id from public.investors where id = p_member)
      and s.voided_at is null
  ), totals as (
    select member_id, greatest(sum(amount_cents), 0) as cents
    from live
    where effective_on <= greatest(p_on, (select min(effective_on) from live))
    group by member_id
  )
  select case
    when coalesce((select sum(cents) from totals), 0) > 0
      then coalesce((select cents from totals where member_id = p_member), 0)::numeric / (select sum(cents) from totals)
    else 0::numeric
  end;
$$;

create or replace view public.investor_member_ledger as
select
  m.id as member_id,
  e.id,
  e.investor_id,
  e.type,
  e.bucket,
  (case
    when w.member_id is not null then e.amount_cents
    else round(e.amount_cents * r.ratio)
  end)::integer as amount_cents,
  e.amount_cents as company_cents,
  (case when w.member_id is not null then 1 else r.ratio end)::numeric as ratio,
  e.settles_at,
  e.settled_at,
  e.reservation_id,
  e.vehicle_id,
  e.allocation_id,
  e.contribution_id,
  e.withdrawal_id,
  e.reversal_of,
  e.statement_id,
  e.memo,
  e.metadata,
  e.created_at,
  (case when w.member_id is not null then e.amount_cents::numeric else e.amount_cents * r.ratio end) as exact_cents
from public.investors m
join public.investor_ledger_entries e on e.investor_id = m.company_id
left join public.investor_ledger_entries o on o.id = e.reversal_of
left join public.investor_withdrawals w on w.id = coalesce(e.withdrawal_id, o.withdrawal_id)
cross join lateral (
  select public.investor_member_ratio(m.id, case
    when w.id is null and coalesce(o.type, e.type) in ('CAPITAL_IN', 'CAPITAL_ALLOCATED', 'CAPITAL_RETURN') then (now() at time zone 'America/Los_Angeles')::date
    else (coalesce(w.created_at, o.created_at, e.created_at) at time zone 'America/Los_Angeles')::date
  end) as ratio
) r
where m.company_id is not null
  and (w.member_id is null or w.member_id = m.id);

create or replace view public.investor_member_balances as
select
  m.id as member_id,
  m.company_id,
  floor(round(coalesce(sum(case when l.bucket = 'AVAILABLE' then l.exact_cents end), 0), 6))::integer as available_cents,
  floor(round(coalesce(sum(case when l.bucket = 'PENDING' then l.exact_cents end), 0), 6))::integer as pending_cents,
  floor(round(coalesce(sum(case when l.bucket = 'INVESTED' then l.exact_cents end), 0), 6))::integer as invested_cents,
  floor(round(coalesce(sum(case when l.bucket = 'PAID_OUT' then l.exact_cents end), 0), 6))::integer as withdrawn_cents,
  coalesce((select sum(w.amount_cents) from public.investor_withdrawals w where w.member_id = m.id and w.status in ('REQUESTED', 'APPROVED')), 0)::integer as held_cents,
  coalesce((select greatest(sum(s.amount_cents), 0) from public.investor_stakes s where s.member_id = m.id and s.voided_at is null and s.effective_on <= (now() at time zone 'America/Los_Angeles')::date), 0)::bigint as stake_cents,
  public.investor_member_ratio(m.id, (now() at time zone 'America/Los_Angeles')::date) as ratio
from public.investors m
left join public.investor_member_ledger l on l.member_id = m.id
where m.company_id is not null
group by m.id, m.company_id;

create or replace function public.investor_member_withdraw(p_member uuid, p_bank_account uuid, p_amount integer) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_available numeric;
  v_last4 text;
  v_id uuid;
begin
  select m.company_id into v_company
  from public.investors m
  join public.investors c on c.id = m.company_id
  where m.id = p_member and m.status = 'ACTIVE' and c.status = 'ACTIVE';
  if v_company is null then
    raise exception 'member_inactive';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  perform pg_advisory_xact_lock(hashtext('investor:' || v_company::text));
  select last4 into v_last4
  from public.investor_bank_accounts
  where id = p_bank_account and investor_id = v_company and removed_at is null and status = 'ACTIVE' and usable_after <= now();
  if v_last4 is null then
    raise exception 'account_unusable';
  end if;
  select floor(round(coalesce(sum(exact_cents), 0), 6)) into v_available from public.investor_member_ledger where member_id = p_member and bucket = 'AVAILABLE';
  if p_amount > v_available then
    raise exception 'insufficient_member';
  end if;
  insert into public.investor_withdrawals (investor_id, member_id, bank_account_id, amount_cents, status)
  values (v_company, p_member, p_bank_account, p_amount, 'REQUESTED')
  returning id into v_id;
  perform public.investor_post(v_company, jsonb_build_array(jsonb_build_object('type', 'WITHHELD', 'bucket', 'AVAILABLE', 'amount_cents', -p_amount, 'withdrawal_id', v_id, 'memo', '•••• ' || v_last4)));
  return v_id;
end;
$$;

create or replace function public.investor_member_link_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_first boolean := true;
  v_second boolean := true;
begin
  if tg_table_name = 'investor_withdrawals' then
    if tg_op = 'UPDATE' then
      v_first := new.member_id is distinct from old.member_id;
    end if;
    if v_first and new.member_id is not null and not exists (select 1 from public.investors m where m.id = new.member_id and m.company_id = new.investor_id) then
      raise exception 'investor_member_mismatch';
    end if;
  else
    if tg_op = 'UPDATE' then
      v_first := new.requested_by is distinct from old.requested_by;
      v_second := new.removal_requested_by is distinct from old.removal_requested_by;
    end if;
    if v_first and new.requested_by is not null and not exists (select 1 from public.investors m where m.id = new.requested_by and m.company_id = new.investor_id) then
      raise exception 'investor_member_mismatch';
    end if;
    if v_second and new.removal_requested_by is not null and not exists (select 1 from public.investors m where m.id = new.removal_requested_by and m.company_id = new.investor_id) then
      raise exception 'investor_member_mismatch';
    end if;
  end if;
  return new;
end;
$$;
