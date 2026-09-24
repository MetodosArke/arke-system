-- Cobrança avulsa e taxa de matrícula (decisão do responsável, 24/09/2026).
--
-- Até aqui o ARKE só cobrava de forma recorrente: a mensalidade do plano da
-- academia e o Método. Taxa de matrícula, avaliação física, personal, diária
-- e produto eram cobrados por fora e lançados à mão no financeiro — ou não
-- eram lançados. A rodada 360° de 24/09/2026 apontou isso como o item de
-- gestão que as primeiras academias mais sentiriam falta.
--
-- A cobrança avulsa segue o mesmo desenho da mensalidade, de propósito:
--   * nasce no banco ANTES de ir ao Asaas, e vai para lá com
--     `externalReference = avulsa:<id>` — é isso que torna a emissão
--     idempotente: repetir a emissão procura a referência antes de criar,
--     e uma cobrança criada no Asaas cuja resposta se perdeu é adotada, não
--     duplicada;
--   * o split é o da mensalidade: a academia recebe o valor menos a taxa de
--     processamento (`arke_taxa_processamento`), que fica na conta da ArkeFit,
--     de onde o Asaas desconta a taxa dele;
--   * o webhook atualiza o status, a conciliação diária pergunta ao Asaas pelo
--     que ficou em aberto, e o pagamento vira lançamento de receita sozinho.
--
-- Uma diferença deliberada: cobrança avulsa vencida NÃO marca o aluno como
-- inadimplente. A situação acompanha a mensalidade, que é o contrato; uma
-- avaliação física atrasada não tira ninguém da academia. O que ela faz é
-- abrir tarefa de cobrança para a recepção.

create type public.cobranca_avulsa_tipo as enum
  ('taxa_matricula', 'avaliacao_fisica', 'personal', 'diaria', 'produto', 'outro');

create table public.cobrancas_avulsas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  tipo public.cobranca_avulsa_tipo not null,
  descricao text not null check (char_length(btrim(descricao)) between 3 and 120),
  valor numeric(10, 2) not null check (valor > 0),
  vencimento date not null,
  -- O mesmo enum da mensalidade: pendente, confirmado, atrasado, estornado,
  -- cancelado. Pendente sem `asaas_payment_id` é emissão não confirmada.
  status public.status_mensalidade not null default 'pendente',
  -- Travados na criação: é o que o split do Asaas pratica, não a taxa do dia.
  valor_repasse_arke numeric(10, 2) not null check (valor_repasse_arke >= 0),
  valor_liquido_academia numeric(10, 2) not null check (valor_liquido_academia > 0),
  taxa_gateway numeric(10, 2) check (taxa_gateway is null or taxa_gateway >= 0),
  asaas_payment_id text,
  invoice_url text,
  emitida_em timestamptz,
  data_pagamento date,
  criada_por uuid references auth.users(id) on delete set null,
  cancelada_por uuid references auth.users(id) on delete set null,
  cancelada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cobrancas_avulsas is
  'Cobrança única ao aluno (taxa de matrícula, avaliação, personal, diária, produto), emitida no Asaas com split para a academia. Escrita só pela edge function asaas-cobranca-avulsa e pelo webhook.';

create unique index idx_cobrancas_avulsas_asaas_payment_id
  on public.cobrancas_avulsas (asaas_payment_id) where asaas_payment_id is not null;
create index idx_cobrancas_avulsas_org_status on public.cobrancas_avulsas (organization_id, status, vencimento);
create index idx_cobrancas_avulsas_aluno_id on public.cobrancas_avulsas (aluno_id);
create index idx_cobrancas_avulsas_criada_por on public.cobrancas_avulsas (criada_por);
create index idx_cobrancas_avulsas_cancelada_por on public.cobrancas_avulsas (cancelada_por);

create trigger trg_cobrancas_avulsas_updated_at
  before update on public.cobrancas_avulsas
  for each row execute function public.set_updated_at();

-- Leitura: o próprio aluno e a equipe da academia — a mesma regra da
-- mensalidade. Sem regra de escrita, de propósito: quem cria, cancela e muda
-- status é a edge function (que confere papel e fala com o Asaas) e o webhook.
-- Uma política de UPDATE para a equipe deixaria marcar como paga uma
-- cobrança que o gateway nunca recebeu.
alter table public.cobrancas_avulsas enable row level security;

create policy "leitura" on public.cobrancas_avulsas
  for select to authenticated
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
  );

grant select on public.cobrancas_avulsas to authenticated;
grant all on public.cobrancas_avulsas to service_role;

-- ── Pagamento vira lançamento de receita ─────────────────────────────────────
-- Espelho de lancar_receita_mensalidade. O `where` no ON CONFLICT não é
-- enfeite: o índice de origem_automatica é parcial, e sem repetir o predicado
-- o Postgres falha em execução (42P10) — o defeito que já derrubou duas
-- funções que nunca tinham rodado.
create or replace function public.lancar_receita_cobranca_avulsa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria_id uuid;
begin
  if new.status = 'confirmado' and old.status is distinct from 'confirmado' then
    select id into v_categoria_id from public.plano_contas
      where organization_id = new.organization_id and tipo = 'receita' and nome = 'Cobranças avulsas (automático)';
    if v_categoria_id is null then
      insert into public.plano_contas (organization_id, tipo, nome)
        values (new.organization_id, 'receita', 'Cobranças avulsas (automático)')
        returning id into v_categoria_id;
    end if;

    insert into public.lancamentos_financeiros
      (organization_id, tipo, categoria_id, categoria, descricao, valor, data, status, data_pagamento, origem_automatica)
    values
      (new.organization_id, 'receita', v_categoria_id, 'Cobranças avulsas (automático)',
       new.descricao || ' — paga via Asaas',
       new.valor_liquido_academia, coalesce(new.data_pagamento, current_date), 'pago',
       coalesce(new.data_pagamento, current_date), 'avulsa:' || new.id::text)
    on conflict (organization_id, origem_automatica) where origem_automatica is not null do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_lancar_receita_cobranca_avulsa
  after update on public.cobrancas_avulsas
  for each row execute function public.lancar_receita_cobranca_avulsa();

-- ── Vencida vira tarefa de cobrança para a recepção ─────────────────────────
-- Tipo `cobranca`: fica com a academia mesmo para aluno do Método
-- (dono_da_tarefa), porque dinheiro é a relação dela com o aluno.
create or replace function public.abrir_tarefa_avulsa_atrasada(_cobranca_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    c.organization_id,
    c.aluno_id,
    'Cobrança avulsa atrasada: ' || c.descricao || ' (venceu em ' || to_char(c.vencimento, 'DD/MM/YYYY') || ')',
    'media',
    now() + interval '48 hours',
    'avulsa_atrasada:' || c.id::text,
    'cobranca'
  from public.cobrancas_avulsas c
  where c.id = _cobranca_id
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

-- ── Saída do aluno: cobrança avulsa em aberto também barra a exclusão ───────
-- Mesma razão da assinatura: excluir faz cascade na linha deste lado e o
-- Asaas segue com uma cobrança viva, mandando lembrete a quem saiu.
-- `_shared/encerrarCobrancas.ts` cancela as avulsas junto com as assinaturas.
create or replace function public.impedir_exclusao_com_cobranca_viva()
returns trigger
language plpgsql
security definer
set search_path = public
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
      'Este aluno tem assinatura ativa no gateway de pagamento. Cancele a cobranca antes de excluir, senao ela continua cobrando sem registro no ARKE.'
      using errcode = 'restrict_violation';
  end if;

  select count(*) into _viva
    from public.aluno_matriculas_academia m
   where m.aluno_id = old.id
     and m.asaas_subscription_id is not null
     and m.status in ('ativa', 'pausada');

  if _viva > 0 then
    raise exception
      'Este aluno tem mensalidade ativa no gateway de pagamento. Cancele a cobranca antes de excluir, senao ela continua cobrando sem registro no ARKE.'
      using errcode = 'restrict_violation';
  end if;

  -- Inclui a emissão não confirmada (sem id do Asaas): ela pode existir lá.
  select count(*) into _viva
    from public.cobrancas_avulsas c
   where c.aluno_id = old.id
     and c.status in ('pendente', 'atrasado');

  if _viva > 0 then
    raise exception
      'Este aluno tem cobranca avulsa em aberto no gateway de pagamento. Cancele-a antes de excluir, senao o aluno continua recebendo a cobranca.'
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

-- Higiene de superfície: função de gatilho e função interna não ficam
-- alcançáveis por /rest/v1/rpc (a revogação em bloco não pega função nova).
revoke execute on function public.lancar_receita_cobranca_avulsa() from public, anon, authenticated;
revoke execute on function public.impedir_exclusao_com_cobranca_viva() from public, anon, authenticated;
revoke execute on function public.abrir_tarefa_avulsa_atrasada(uuid) from public, anon, authenticated;
grant execute on function public.abrir_tarefa_avulsa_atrasada(uuid) to service_role;
