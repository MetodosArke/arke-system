-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A carteira de recebimento da academia muda junto com o registro (06/10/2026).
--
-- A carteira (`organizations.asaas_wallet_id`) é para onde o split manda a
-- parte da academia em toda cobrança futura. Trocá-la não deixava rastro: a
-- edge function gravava a coluna e pronto. Uma sessão de gestor roubada
-- apontava o dinheiro para outra conta sem que ninguém soubesse quando nem
-- quem.
--
-- Esta função grava a carteira e a linha de `auditoria_acoes_sensiveis` na
-- mesma transação: ou as duas ficam, ou nenhuma. Ela devolve a carteira de
-- antes, para a edge function saber se foi troca e avisar a ArkeFit. Quem
-- confere o papel e as duas etapas é a edge function (`asaas-conta-academia`),
-- a única que chama, com a service_role.
create or replace function public.definir_carteira_recebimento(
  _organization_id uuid,
  _wallet_id text,
  _ator_user_id uuid,
  _papel text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior text;
  v_nome text;
begin
  if _wallet_id is null or _wallet_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Carteira inválida.' using errcode = '22023';
  end if;

  select o.asaas_wallet_id, o.nome into v_anterior, v_nome
    from public.organizations o
   where o.id = _organization_id
   for update;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;

  update public.organizations
     set asaas_wallet_id = _wallet_id,
         asaas_conta_origem = 'existente',
         asaas_conta_id = null,
         asaas_conta_status = null,
         asaas_conta_status_em = null
   where id = _organization_id;

  if v_anterior is distinct from _wallet_id then
    perform public.registrar_auditoria(
      _ator_user_id,
      case when v_anterior is null then 'organizacao.carteira_vinculada' else 'organizacao.carteira_trocada' end,
      'organizations',
      _organization_id,
      v_nome,
      jsonb_build_object('carteira_anterior', v_anterior, 'carteira_nova', _wallet_id, 'papel', _papel)
    );
  end if;

  return v_anterior;
end;
$$;

revoke execute on function public.definir_carteira_recebimento(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.definir_carteira_recebimento(uuid, text, uuid, text) to service_role;
