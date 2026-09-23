alter table public.approvals alter column reservation_id drop not null;
alter table public.approvals add column investor_withdrawal_id uuid references public.investor_withdrawals (id) on delete cascade;
alter table public.approvals drop constraint approvals_kind_check;
alter table public.approvals add constraint approvals_kind_check check (kind in ('REFUND', 'CAPTURE', 'CHARGE', 'DISCOUNT', 'PAYOUT'));
alter table public.approvals add constraint approvals_target_check check (reservation_id is not null or investor_withdrawal_id is not null);
create index approvals_withdrawal_idx on public.approvals (investor_withdrawal_id) where investor_withdrawal_id is not null;

alter table public.investor_withdrawals
  add constraint investor_withdrawals_approval_fkey foreign key (approval_id) references public.approvals (id) on delete set null;
