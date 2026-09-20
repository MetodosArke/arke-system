-- Correções da avaliação da jornada do aluno (G1 e G3) e o trial do
-- Método ARKE para o aluno, espelhando o trial B2B.

-- ---------------------------------------------------------------------
-- G1 — Registro do primeiro acesso
-- ---------------------------------------------------------------------
-- O app tentava gravar `alunos.primeiro_acesso_em` com a identidade do
-- próprio aluno. A policy de `alunos` dá a ele só SELECT (escrita é da
-- equipe), então o UPDATE não atingia linha nenhuma — e a chamada era
-- descartada sem checar erro, de modo que ninguém percebia. Resultado: o
-- campo ficava nulo para todo mundo e a automação "sem 1º acesso após 48h"
-- abria tarefa de ativação para quem já tinha entrado.
--
-- Agora o carimbo é do servidor, por RPC. O aluno não ganha permissão de
-- escrita na tabela: a função é security definer e só toca a própria linha.
create or replace function public.registrar_primeiro_acesso_aluno()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `is null` no where mantém a função idempotente: o primeiro acesso é o
  -- primeiro, e chamadas seguintes (todo login recarrega o perfil) não
  -- reescrevem a data.
  update public.alunos
     set primeiro_acesso_em = now()
   where user_id = auth.uid()
     and primeiro_acesso_em is null;
end;
$$;

comment on function public.registrar_primeiro_acesso_aluno() is
  'Carimba alunos.primeiro_acesso_em do usuário autenticado, uma única vez. Existe porque o aluno não tem (nem deve ter) permissão de UPDATE na tabela.';

revoke all on function public.registrar_primeiro_acesso_aluno() from public, anon;
grant execute on function public.registrar_primeiro_acesso_aluno() to authenticated;

-- ---------------------------------------------------------------------
-- G3 — Assinatura exige adesão ao Método
-- ---------------------------------------------------------------------
-- asaas-create-subscription montava a cobrança a partir de
-- `alunos.nivel_atacado` sem olhar `metodo_arke_status`. Como o nível fica
-- preenchido mesmo em aluno `sem_adesao`, dava para emitir assinatura — e
-- liquidar o repasse de atacado à ARKE — de um produto não contratado.
--
-- A guarda entra no banco além da Edge Function: assim vale para qualquer
-- caminho de escrita, inclusive service_role, que ignora RLS.
create or replace function public.exigir_adesao_para_assinatura()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status public.metodo_arke_status;
  v_nome text;
begin
  -- Cancelar uma assinatura de quem perdeu a adesão tem que continuar
  -- possível, senão o cancelamento ficaria preso pela própria guarda.
  if new.status = 'cancelada' then
    return new;
  end if;

  select a.metodo_arke_status, coalesce(p.full_name, 'aluno')
    into v_status, v_nome
    from public.alunos a
    left join public.profiles p on p.user_id = a.user_id
   where a.id = new.aluno_id;

  if v_status is distinct from 'ativo' then
    raise exception
      'Não é possível criar assinatura do Método ARKE para % : a adesão está como "%". Ative a adesão (ou inicie um trial) antes de cobrar.',
      v_nome, coalesce(v_status::text, 'aluno inexistente');
  end if;

  return new;
end;
$$;

revoke all on function public.exigir_adesao_para_assinatura() from public, anon, authenticated;

drop trigger if exists trg_assinatura_exige_adesao on public.aluno_assinaturas;
create trigger trg_assinatura_exige_adesao
  before insert or update of aluno_id, status on public.aluno_assinaturas
  for each row execute function public.exigir_adesao_para_assinatura();

-- ---------------------------------------------------------------------
-- Trial do Método ARKE para o aluno
-- ---------------------------------------------------------------------
-- Mesma ideia do trial B2B: dá acesso completo ao produto, tem prazo e não
-- gera cobrança nenhuma. A diferença é que aqui o nível importa — o Método
-- tem três (essencial, integrado, elite) e cada um entrega coisas
-- diferentes, então o trial é por nível.
--
-- Nada disto toca o Asaas: não há customer, subscription nem split. É
-- homologação, e `valor_cobrado = 0` deixa isso explícito para quem ler a
-- linha depois.
create or replace function public.iniciar_trial_metodo_arke(
  _aluno_id uuid,
  _nivel public.nivel_atacado
)
returns public.aluno_assinaturas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_assinatura public.aluno_assinaturas;
begin
  select a.organization_id into v_org from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not (public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')
          or public.is_org_staff(auth.uid(), v_org)) then
    raise exception 'Apenas a equipe da academia ou a ArkeFit podem iniciar um trial.';
  end if;

  -- O trial ativa a adesão: é o que faz o aluno entrar no onboarding
  -- M.A.P.A.® e percorrer a jornada de verdade, que é o ponto de homologar.
  update public.alunos
     set metodo_arke_status = 'ativo',
         nivel_atacado = _nivel
   where id = _aluno_id;

  insert into public.aluno_assinaturas
    (organization_id, aluno_id, nivel_atacado, valor_cobrado, status, trial_fim)
  values
    (v_org, _aluno_id, _nivel, 0, 'trial', current_date + public.arke_trial_dias())
  on conflict (aluno_id) do update
    set nivel_atacado = excluded.nivel_atacado,
        valor_cobrado = 0,
        status = 'trial',
        trial_fim = excluded.trial_fim,
        -- Um trial não tem cobrança pendente herdada de um estado anterior.
        fatura_pendente_url = null,
        asaas_subscription_id = null,
        proxima_cobranca = null
  returning * into v_assinatura;

  return v_assinatura;
end;
$$;

comment on function public.iniciar_trial_metodo_arke(uuid, public.nivel_atacado) is
  'Coloca o aluno em trial do Método ARKE no nível indicado: ativa a adesão, não cria nada no Asaas e não gera cobrança. Espelha o trial B2B de organizations.';

revoke all on function public.iniciar_trial_metodo_arke(uuid, public.nivel_atacado) from public, anon;
grant execute on function public.iniciar_trial_metodo_arke(uuid, public.nivel_atacado) to authenticated;

create or replace function public.encerrar_trial_metodo_arke(_aluno_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select a.organization_id into v_org from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not (public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')
          or public.is_org_staff(auth.uid(), v_org)) then
    raise exception 'Apenas a equipe da academia ou a ArkeFit podem encerrar um trial.';
  end if;

  -- Cancela a assinatura antes de tirar a adesão: a guarda de adesão
  -- permite o cancelamento, mas não permitiria mexer numa assinatura de
  -- aluno já marcado como sem_adesao.
  update public.aluno_assinaturas
     set status = 'cancelada'
   where aluno_id = _aluno_id and status = 'trial';

  update public.alunos
     set metodo_arke_status = 'sem_adesao'
   where id = _aluno_id;
end;
$$;

comment on function public.encerrar_trial_metodo_arke(uuid) is
  'Encerra o trial do Método: cancela a assinatura de homologação e devolve o aluno a sem_adesao.';

revoke all on function public.encerrar_trial_metodo_arke(uuid) from public, anon;
grant execute on function public.encerrar_trial_metodo_arke(uuid) to authenticated;
