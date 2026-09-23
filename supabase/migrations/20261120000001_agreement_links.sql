create table public.agreement_links (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  emails_sent integer not null default 0
);

create index agreement_links_reservation_idx on public.agreement_links (reservation_id, created_at desc);

alter table public.agreement_links enable row level security;
revoke all on public.agreement_links from anon, authenticated;
grant select, insert, update, delete on public.agreement_links to service_role;

create function public.count_agreement_link_email(p_link_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  update public.agreement_links
  set emails_sent = emails_sent + 1
  where id = p_link_id and emails_sent < p_limit and revoked_at is null and expires_at > now()
  returning emails_sent into v_count;
  return v_count is not null;
end;
$function$;

revoke all on function public.count_agreement_link_email(uuid, integer) from public, anon, authenticated;
grant execute on function public.count_agreement_link_email(uuid, integer) to service_role;
