-- Auditoria de prontidão, rodada 1: o dinheiro (06/10/2026).
--
-- Três defeitos da auditoria de 05/10, todos no caminho do repasse e do
-- Método ARKE:
--
-- 1. A exceção de repasse por nível (`organization_planos_precificacao.repasse_*`)
--    não tinha a trava que o repasse da academia (`organizations.repasse_*`) já
--    tem. A regra de alteração da tabela é do gestor, porque é ali que ele põe o
--    preço de varejo — e a mesma regra o deixava gravar a exceção de repasse.
--    Numa transação desfeita, a gestora da academia de demonstração gravou uma
--    exceção de R$ 0 no Integrado e o repasse de uma mensalidade de R$ 119 caiu
--    de R$ 49,05 para R$ 4,05 (só a taxa do gateway).
-- 2. `pagamentos` (as cobranças do Método, receita da ArkeFit) tinha uma regra
--    única para todas as operações, com toda a equipe da academia. Quem grava
--    pagamento é o webhook do Asaas, pela service role; a tela só lê.
-- 3. Cancelar a assinatura do Método parava a cobrança, mas o aluno seguia com
--    `metodo_arke_status = 'ativo'`, e o plano é calculado por essa coluna.

set lock_timeout = '5s';

-- ── 1. A exceção de repasse é da ArkeFit ──────────────────────────────────
--
-- Incluir, alterar e apagar. Apagar também: a exceção que a ArkeFit pôs acima
-- do negociado (o Elite costuma custar mais de servir) sairia, e o nível
-- voltaria a reter só o valor da academia.
create or replace function public.proteger_repasse_por_nivel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Sem usuário é a service role ou uma rotina; a ArkeFit passa com as duas
  -- etapas (has_role já exige).
  if v_uid is null or public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' and (new.repasse_tipo is not null or new.repasse_valor is not null) then
    raise exception 'O repasse do Método é definido pela ArkeFit.' using errcode = '42501';
  elsif tg_op = 'UPDATE'
        and (new.repasse_tipo is distinct from old.repasse_tipo or new.repasse_valor is distinct from old.repasse_valor) then
    raise exception 'O repasse do Método é definido pela ArkeFit.' using errcode = '42501';
  elsif tg_op = 'DELETE' and (old.repasse_tipo is not null or old.repasse_valor is not null) then
    raise exception 'O repasse do Método é definido pela ArkeFit.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_proteger_repasse_por_nivel on public.organization_planos_precificacao;
create trigger trg_proteger_repasse_por_nivel
  before insert or update or delete on public.organization_planos_precificacao
  for each row execute function public.proteger_repasse_por_nivel();

-- ── 2. Pagamentos do Método: a equipe só lê ────────────────────────────────
drop policy if exists "staff da org vê/gerencia pagamentos da própria organização" on public.pagamentos;
drop policy if exists "leitura" on public.pagamentos;
create policy "leitura" on public.pagamentos for select to authenticated
  using (
    public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
  );

revoke insert, update, delete on public.pagamentos from anon, authenticated;

-- ── 3. Assinatura do Método cancelada encerra o Método no aluno ────────────
--
-- No banco, e não na função que cancela: o cancelamento chega por mais de um
-- caminho (a tela, o webhook, o encerramento da academia), e todos passam por
-- esta linha. O gatilho `trg_metodo_saida_limpa_mentor` tira o mentor, e o
-- RLS do Mentor Centralizado devolve treino, dieta e anamnese à academia.
create or replace function public.encerrar_metodo_ao_cancelar_assinatura()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'cancelada' and old.status is distinct from 'cancelada' then
    update public.alunos
       set metodo_arke_status = 'cancelado'
     where id = new.aluno_id
       and metodo_arke_status = 'ativo';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_assinatura_cancelada_encerra_metodo on public.aluno_assinaturas;
create trigger trg_assinatura_cancelada_encerra_metodo
  after update of status on public.aluno_assinaturas
  for each row execute function public.encerrar_metodo_ao_cancelar_assinatura();

-- Quem já cancelou e ficou com o Método ativo.
update public.alunos a
   set metodo_arke_status = 'cancelado'
 where a.metodo_arke_status = 'ativo'
   and exists (select 1 from public.aluno_assinaturas s where s.aluno_id = a.id and s.status = 'cancelada')
   and not exists (
     select 1 from public.aluno_assinaturas s
      where s.aluno_id = a.id and s.status in ('ativa', 'atrasada', 'pausada', 'trial')
   );

-- Funções de gatilho nascem com EXECUTE para o PUBLIC.
revoke execute on function public.proteger_repasse_por_nivel() from public, anon, authenticated;
revoke execute on function public.encerrar_metodo_ao_cancelar_assinatura() from public, anon, authenticated;
