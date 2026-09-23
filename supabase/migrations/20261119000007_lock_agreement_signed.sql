create function public.lock_agreement_signed(p_reservation_id uuid, p_terms text, p_terms_zh text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.reservations;
begin
  select * into v_row from public.reservations where id = p_reservation_id for update;
  if not found then
    return 'changed';
  end if;
  if v_row.agreement_state = 'SIGNED' then
    return 'signed';
  end if;
  if v_row.special_terms is distinct from p_terms or v_row.special_terms_zh is distinct from p_terms_zh then
    return 'changed';
  end if;
  update public.reservations set agreement_state = 'SIGNED' where id = p_reservation_id;
  return 'locked';
end;
$function$;

revoke all on function public.lock_agreement_signed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lock_agreement_signed(uuid, text, text) to service_role;
