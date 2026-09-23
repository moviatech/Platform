alter table public.investors
  add column kind text not null default 'INDIVIDUAL' check (kind in ('INDIVIDUAL', 'COMPANY')),
  add column company_id uuid references public.investors (id) on delete restrict;

alter table public.investors alter column email drop not null;
alter table public.investors alter column phone drop not null;
alter table public.investors add constraint investors_contact_check check (kind = 'COMPANY' or (email is not null and phone is not null));
alter table public.investors add constraint investors_company_check check (company_id is null or (kind = 'INDIVIDUAL' and company_id <> id));

create index investors_company_idx on public.investors (company_id) where company_id is not null;

create table public.investor_stakes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.investors (id) on delete restrict,
  member_id uuid not null references public.investors (id) on delete restrict,
  amount_cents bigint not null check (amount_cents <> 0),
  effective_on date not null,
  note text,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.staff_members (user_id) on delete set null
);

create index investor_stakes_company_idx on public.investor_stakes (company_id, effective_on);
create index investor_stakes_member_idx on public.investor_stakes (member_id, effective_on);

alter table public.investor_stakes enable row level security;
revoke all on public.investor_stakes from anon, authenticated;
grant all on public.investor_stakes to service_role;

alter table public.investor_withdrawals add column member_id uuid references public.investors (id) on delete restrict;
create index investor_withdrawals_member_idx on public.investor_withdrawals (member_id, created_at desc) where member_id is not null;

alter table public.investor_bank_accounts
  add column status text not null default 'ACTIVE' check (status in ('PENDING', 'ACTIVE', 'DECLINED')),
  add column requested_by uuid references public.investors (id) on delete set null,
  add column decided_by uuid references public.staff_members (user_id) on delete set null,
  add column decided_at timestamptz,
  add column decision_note text,
  add column removal_requested_by uuid references public.investors (id) on delete set null,
  add column removal_requested_at timestamptz;

create function public.investor_company_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_joined boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_joined := new.company_id is distinct from old.company_id;
  end if;
  if new.company_id is not null then
    if not exists (select 1 from public.investors c where c.id = new.company_id and c.kind = 'COMPANY' and c.company_id is null and c.compensation = 'REVENUE_SHARE') then
      raise exception 'investor_company_invalid';
    end if;
    if v_joined then
      if exists (select 1 from public.investor_allocations where investor_id = new.id)
        or exists (select 1 from public.investor_contributions where investor_id = new.id)
        or exists (select 1 from public.investor_ledger_entries where investor_id = new.id)
        or exists (select 1 from public.investor_bank_accounts where investor_id = new.id)
        or exists (select 1 from public.investor_withdrawals where investor_id = new.id) then
        raise exception 'investor_member_has_money';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.company_id is not null and new.company_id is distinct from old.company_id
      and (exists (select 1 from public.investor_stakes where member_id = new.id and voided_at is null)
        or exists (select 1 from public.investor_withdrawals where member_id = new.id)) then
      raise exception 'investor_member_has_stake';
    end if;
    if (new.kind <> 'COMPANY' or new.compensation <> 'REVENUE_SHARE') and exists (select 1 from public.investors m where m.company_id = new.id) then
      raise exception 'investor_company_has_members';
    end if;
  end if;
  return new;
end;
$$;

create trigger investors_company_guard before insert or update of kind, company_id, compensation on public.investors
for each row execute function public.investor_company_guard();

create function public.investor_owner_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.investors where id = new.investor_id and company_id is not null) then
    raise exception 'investor_is_member';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['investor_allocations', 'investor_contributions', 'investor_ledger_entries', 'investor_bank_accounts', 'investor_withdrawals', 'investor_mileage_statements', 'investor_mileage_rates'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.investor_owner_guard()', t || '_owner', t);
  end loop;
end;
$$;

create function public.investor_stake_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.investors m where m.id = new.member_id and m.company_id = new.company_id) then
    raise exception 'investor_stake_mismatch';
  end if;
  return new;
end;
$$;

create trigger investor_stakes_guard before insert on public.investor_stakes
for each row execute function public.investor_stake_guard();

create function public.investor_member_ratio(p_member uuid, p_on date) returns numeric
language sql
stable
set search_path = ''
as $$
  with totals as (
    select s.member_id, greatest(sum(s.amount_cents), 0) as cents
    from public.investor_stakes s
    where s.company_id = (select company_id from public.investors where id = p_member)
      and s.voided_at is null
      and s.effective_on <= p_on
    group by s.member_id
  )
  select case
    when coalesce((select sum(cents) from totals), 0) > 0
      then coalesce((select cents from totals where member_id = p_member), 0)::numeric / (select sum(cents) from totals)
    else 0::numeric
  end;
$$;

create view public.investor_member_ledger as
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
  e.created_at
from public.investors m
join public.investor_ledger_entries e on e.investor_id = m.company_id
left join public.investor_withdrawals w on w.id = e.withdrawal_id
left join public.investor_ledger_entries o on o.id = e.reversal_of
cross join lateral (
  select public.investor_member_ratio(m.id, (coalesce(w.created_at, o.created_at, e.created_at) at time zone 'America/Los_Angeles')::date) as ratio
) r
where m.company_id is not null
  and (w.member_id is null or w.member_id = m.id);

create view public.investor_member_balances as
select
  m.id as member_id,
  m.company_id,
  coalesce(sum(case when l.bucket = 'AVAILABLE' then l.amount_cents end), 0)::integer as available_cents,
  coalesce(sum(case when l.bucket = 'PENDING' then l.amount_cents end), 0)::integer as pending_cents,
  coalesce(sum(case when l.bucket = 'INVESTED' then l.amount_cents end), 0)::integer as invested_cents,
  coalesce(sum(case when l.bucket = 'PAID_OUT' then l.amount_cents end), 0)::integer as withdrawn_cents,
  coalesce((select sum(w.amount_cents) from public.investor_withdrawals w where w.member_id = m.id and w.status in ('REQUESTED', 'APPROVED')), 0)::integer as held_cents,
  coalesce((select greatest(sum(s.amount_cents), 0) from public.investor_stakes s where s.member_id = m.id and s.voided_at is null and s.effective_on <= (now() at time zone 'America/Los_Angeles')::date), 0)::bigint as stake_cents,
  public.investor_member_ratio(m.id, (now() at time zone 'America/Los_Angeles')::date) as ratio
from public.investors m
left join public.investor_member_ledger l on l.member_id = m.id
where m.company_id is not null
group by m.id, m.company_id;

revoke all on public.investor_member_ledger from anon, authenticated;
grant select on public.investor_member_ledger to service_role;
revoke all on public.investor_member_balances from anon, authenticated;
grant select on public.investor_member_balances to service_role;

create function public.investor_member_withdraw(p_member uuid, p_bank_account uuid, p_amount integer) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_available bigint;
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
  select coalesce(sum(amount_cents), 0) into v_available from public.investor_member_ledger where member_id = p_member and bucket = 'AVAILABLE';
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

revoke all on function public.investor_member_ratio(uuid, date) from public, anon, authenticated;
grant execute on function public.investor_member_ratio(uuid, date) to service_role;
revoke all on function public.investor_member_withdraw(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.investor_member_withdraw(uuid, uuid, integer) to service_role;

create or replace function public.investor_purge(p_investor_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  alter table public.investor_ledger_entries disable trigger investor_ledger_immutable;
  delete from public.notifications where investor_id = p_investor_id;
  update public.conversations set investor_id = null where investor_id = p_investor_id;
  delete from public.investor_stakes where member_id = p_investor_id or company_id = p_investor_id;
  update public.investor_withdrawals set member_id = null where member_id = p_investor_id or investor_id = p_investor_id;
  update public.investors set company_id = null where company_id = p_investor_id;
  delete from public.investor_settlement_holds where investor_id = p_investor_id
    or entry_id in (select id from public.investor_ledger_entries where investor_id = p_investor_id)
    or vehicle_id in (select vehicle_id from public.investor_allocations where investor_id = p_investor_id);
  delete from public.approvals where investor_withdrawal_id in (select id from public.investor_withdrawals where investor_id = p_investor_id);
  delete from public.investor_ledger_entries where investor_id = p_investor_id;
  delete from public.investor_mileage_statements where investor_id = p_investor_id;
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
