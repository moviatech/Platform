drop function public.lock_agreement_signed(uuid, text, text);

create function public.sign_reservation_agreement(p_reservation_id uuid, p_seen_at timestamptz, p_agreement jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.reservations;
  v_version integer;
  v_signed_at timestamptz := (p_agreement ->> 'signed_at')::timestamptz;
begin
  select * into v_row from public.reservations where id = p_reservation_id for update;
  if not found then
    return jsonb_build_object('outcome', 'changed');
  end if;
  if v_row.agreement_state = 'SIGNED' then
    return jsonb_build_object('outcome', 'already');
  end if;
  if v_row.updated_at is distinct from p_seen_at then
    return jsonb_build_object('outcome', 'changed');
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.agreements where reservation_id = p_reservation_id;
  update public.agreements set superseded_at = v_signed_at where reservation_id = p_reservation_id and superseded_at is null;
  insert into public.agreements (reservation_id, customer_id, version, template_version, locale, terms_snapshot, terms_hash, signer_name, signer_ip, user_agent, signed_at, elections, signature_image)
  values (
    p_reservation_id,
    v_row.customer_id,
    v_version,
    p_agreement ->> 'template_version',
    p_agreement ->> 'locale',
    p_agreement ->> 'terms_snapshot',
    p_agreement ->> 'terms_hash',
    p_agreement ->> 'signer_name',
    p_agreement ->> 'signer_ip',
    p_agreement ->> 'user_agent',
    v_signed_at,
    coalesce(p_agreement -> 'elections', '{}'::jsonb),
    p_agreement ->> 'signature_image'
  );
  update public.reservations set agreement_state = 'SIGNED' where id = p_reservation_id;
  return jsonb_build_object('outcome', 'signed', 'version', v_version);
end;
$function$;

revoke all on function public.sign_reservation_agreement(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.sign_reservation_agreement(uuid, timestamptz, jsonb) to service_role;
