-- superadmin-suporte-tenant (ação excluir_organizacao) apaga a linha em
-- organizations e depende do "on delete cascade" em organization_id para
-- limpar organization_members em cascata. O trigger
-- trg_prevent_remover_ultimo_gestor, porém, dispara para CADA linha
-- removida de organization_members — inclusive quando ela está sendo
-- apagada porque a organização INTEIRA está sendo excluída, não porque
-- alguém está tentando destravar/remover o gestor de um tenant que
-- continua existindo. Como o único gestor de "Teste Novo Jean" não tem
-- outro gestor ativo, `v_outros_gestores_ativos = 0` e o trigger levanta
-- a exceção, derrubando a transação inteira do DELETE FROM organizations
-- com um erro 500 genérico ("Erro ao excluir a organização.").
--
-- Correção: quando a organização já não existe mais (cascade da própria
-- exclusão — dentro da mesma transação, o DELETE FROM organizations já
-- aconteceu antes do Postgres disparar o cascade nas tabelas filhas), a
-- trava não faz sentido e é ignorada.
create or replace function public.prevent_remover_ultimo_gestor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_outros_gestores_ativos integer;
begin
  v_org_id := coalesce(old.organization_id, new.organization_id);

  if old.role = 'gestor' and old.status = 'active'
     and (tg_op = 'DELETE' or (tg_op = 'UPDATE' and (new.status <> 'active' or new.role <> 'gestor')))
     and exists (select 1 from public.organizations where id = v_org_id) then

    select count(*) into v_outros_gestores_ativos
      from public.organization_members
      where organization_id = v_org_id
        and role = 'gestor'
        and status = 'active'
        and user_id <> old.user_id;

    if v_outros_gestores_ativos = 0 then
      raise exception 'Não é possível remover ou inativar o único gestor ativo da organização.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
