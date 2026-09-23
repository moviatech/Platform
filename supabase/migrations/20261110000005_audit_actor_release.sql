create or replace function public.block_audit_mutation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.actor_user_id is not null
    and new.actor_user_id is null
    and new.id = old.id
    and new.actor_type = old.actor_type
    and new.action = old.action
    and new.entity_type = old.entity_type
    and new.entity_id is not distinct from old.entity_id
    and new.metadata = old.metadata
    and new.ip_address is not distinct from old.ip_address
    and new.user_agent is not distinct from old.user_agent
    and new.created_at = old.created_at
    and not exists (select 1 from auth.users u where u.id = old.actor_user_id) then
    return new;
  end if;
  raise exception 'audit_events_append_only';
end;
$$;
