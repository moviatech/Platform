create function public.is_marketing_only() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_roles where user_id = (select auth.uid()) and role = 'MARKETING')
    and not exists (select 1 from public.staff_roles where user_id = (select auth.uid()) and role <> 'MARKETING')
$$;

revoke all on function public.is_marketing_only() from public, anon;
grant execute on function public.is_marketing_only() to authenticated, service_role;

create or replace function public.is_staff() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    and exists (
      select 1 from public.staff_members
      where user_id = (select auth.uid()) and active
    )
    and not public.is_marketing_only();
$$;

create policy staff_locations_self on public.staff_locations for select to authenticated using (user_id = (select auth.uid()));
