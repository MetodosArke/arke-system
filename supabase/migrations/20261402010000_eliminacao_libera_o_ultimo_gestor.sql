-- A eliminação da academia apaga a conta do único gestor (06/10/2026).
--
-- A prova de ponta a ponta do encerramento, pela função publicada, parou na
-- eliminação com "Database error deleting user". A função
-- `encerramento-organizacao` apaga as contas sem outro vínculo antes de
-- `eliminar_organizacao` apagar a academia; a conta do gestor leva junto, em
-- cascata, o vínculo dele, e `prevent_remover_ultimo_gestor` recusa remover
-- o único gestor enquanto a academia existe. Toda academia com um gestor só
-- (quase todas) travava ali, e a eliminação ficava tentando de hora em hora.
--
-- A regra do único gestor protege a academia que segue funcionando. A
-- academia que já foi encerrada e passou da data de eliminação não precisa
-- dela: a regra passa a não valer nessa janela. Fora dela, nada muda.

set lock_timeout = '5s';

create or replace function public.prevent_remover_ultimo_gestor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid;
  v_outros_gestores integer;
begin
  v_org_id := coalesce(old.organization_id, new.organization_id);

  if old.role = 'gestor' and old.status = 'active'
     and (tg_op = 'DELETE' or (tg_op = 'UPDATE' and (new.status <> 'active' or new.role <> 'gestor')))
     and exists (select 1 from public.organizations where id = v_org_id)
     -- A academia em eliminação (encerrada e passada a data) sai inteira.
     and not exists (select 1 from public.organizacao_encerramentos e
                      where e.organization_id = v_org_id
                        and e.etapa = 'encerrada'
                        and e.eliminacao_em <= now()) then

    select count(*) into v_outros_gestores
      from public.organization_members
      where organization_id = v_org_id
        and role = 'gestor'
        and status in ('active', 'pending')
        and user_id <> old.user_id;

    if v_outros_gestores = 0 then
      raise exception 'Não é possível remover ou inativar o único gestor ativo da organização.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke execute on function public.prevent_remover_ultimo_gestor() from public, anon, authenticated;
