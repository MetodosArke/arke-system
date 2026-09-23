-- Ciclo de vida da assinatura: cancelar, pausar e alterar valor (23/09/2026).
--
-- Até aqui o sistema sabia **criar** cobrança e não sabia parar. Não existia
-- cancelar, pausar nem alterar valor em lugar nenhum — nem tela, nem edge
-- function, nem chamada ao gateway. O valor `cancelada` do enum era só rótulo
-- de tela: ninguém nunca o gravava.
--
-- As consequências eram concretas e todas na direção mais cara, que é cobrar
-- quem não deve ser cobrado:
--
--   * excluir um aluno faz `cascade` em `aluno_assinaturas`, e a assinatura
--     seguia `ACTIVE` no Asaas cobrando uma pessoa real todo mês, sem registro
--     nenhum do nosso lado. A varredura de órfãs detecta e não corrige;
--   * pausar um aluno tirava o acesso e mantinha a cobrança;
--   * mudar o preço de varejo não alcançava quem já era assinante.
--
-- E um defeito que o sandbox revelou, pior que a ausência: **cancelar
-- bloqueava o aluno**. O `PAYMENT_DELETED` do Asaas virava `estornado`, e a
-- condição do B2C pegava qualquer status que não fosse `confirmado` — então a
-- cobrança apagada, com vencimento no passado, trancava justamente quem não
-- devia mais nada.

-- ── 1. Situação da cobrança: lista de inclusão, não de exclusão ─────────────
--
-- A causa raiz em uma linha: o B2C perguntava `status <> 'confirmado'`
-- (lista de exclusão) enquanto o B2B pergunta `status in ('pendente',
-- 'atrasado')` (lista de inclusão). A lista de exclusão trata todo status
-- novo como dívida por omissão — foi por isso que só o B2C quebrou quando
-- apareceu `estornado`, e quebraria de novo em `cancelado`.
--
-- Dívida é só o que está esperando pagamento: pendente ou atrasado. Cobrança
-- estornada ou cancelada não é dívida — não há o que pagar.
create or replace function public.aluno_inadimplente_b2c(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.aluno_assinaturas a
    join public.pagamentos p on p.aluno_assinatura_id = a.id
    where a.aluno_id = _aluno_id
      -- `trial` é homologação, `cancelada` encerrou a relação e `pausada` é
      -- pausa combinada: nenhuma delas é alguém a quem cobrar acesso.
      and a.status in ('ativa', 'atrasada')
      -- Lista de inclusão: só cobrança à espera de pagamento é dívida.
      and p.status in ('pendente', 'atrasado')
      and (
        p.status = 'atrasado'
        or (p.vencimento is not null and p.vencimento < current_date)
      )
  );
$$;

comment on function public.aluno_inadimplente_b2c(uuid) is
  'Aluno com cobrança do Método emitida e vencida sem confirmação. Usa lista de inclusão de status (pendente/atrasado): cobrança cancelada ou estornada não é dívida.';

-- ── 2. Rastro de quem parou a cobrança ─────────────────────────────────────
--
-- Parar de cobrar alguém é decisão que precisa se explicar depois — tanto
-- para a academia quanto para o aluno que reclamar. Mesma razão de
-- `mover_fase_jornada` registrar autor e motivo.
alter table public.aluno_assinaturas
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por uuid references auth.users(id) on delete set null,
  add column if not exists cancelamento_motivo text,
  add column if not exists pausada_em timestamptz,
  add column if not exists pausada_por uuid references auth.users(id) on delete set null;

comment on column public.aluno_assinaturas.cancelamento_motivo is
  'Por que a cobrança foi encerrada. Obrigatório no cancelamento pela edge function.';

-- ── 3. Excluir aluno não pode deixar cobrança viva no gateway ──────────────
--
-- As FKs de `aluno_assinaturas`, `mensalidades` e `aluno_matriculas_academia`
-- são `on delete cascade`: apagar o aluno apaga silenciosamente todo o rastro
-- financeiro deste lado, enquanto o Asaas segue cobrando. A trava mora aqui,
-- e não na edge function de exclusão, porque vale para **todo** caminho de
-- escrita — inclusive `service_role`, que ignora RLS, e inclusive os caminhos
-- que ninguém lembrar de ajustar.
--
-- Não impede excluir: obriga a ordem certa. Cancelar no gateway primeiro,
-- apagar depois.
create or replace function public.impedir_exclusao_com_cobranca_viva()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _viva int;
begin
  select count(*) into _viva
    from public.aluno_assinaturas s
   where s.aluno_id = old.id
     and s.asaas_subscription_id is not null
     and s.status in ('ativa', 'atrasada', 'pausada');

  if _viva > 0 then
    raise exception
      'Este aluno tem assinatura ativa no gateway de pagamento. Cancele a cobrança antes de excluir, senão ela continua cobrando sem registro no ARKE.'
      using errcode = 'restrict_violation';
  end if;

  select count(*) into _viva
    from public.aluno_matriculas_academia m
   where m.aluno_id = old.id
     and m.asaas_subscription_id is not null
     and m.status in ('ativa', 'pausada');

  if _viva > 0 then
    raise exception
      'Este aluno tem mensalidade ativa no gateway de pagamento. Cancele a cobrança antes de excluir, senão ela continua cobrando sem registro no ARKE.'
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_impedir_exclusao_com_cobranca_viva on public.alunos;
create trigger trg_impedir_exclusao_com_cobranca_viva
  before delete on public.alunos
  for each row execute function public.impedir_exclusao_com_cobranca_viva();

-- Função de gatilho herda EXECUTE do PUBLIC e aparece em /rest/v1/rpc.
-- Regra do projeto: revogar depois de cada rodada que cria gatilho.
revoke execute on function public.impedir_exclusao_com_cobranca_viva() from public;
