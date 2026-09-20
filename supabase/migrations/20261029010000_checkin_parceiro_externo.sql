-- Check-in de visitantes via agregadores (Wellhub/Gympass, TotalPass):
-- alunos esporádicos que não são necessariamente cadastrados como `alunos`
-- da academia — hoje a liberação da catraca para eles é 100% manual na
-- recepção. Esta migration prepara a estrutura para isso:
--
-- 1. organizacao_credenciais_parceiro: credenciais/identificador do
--    estabelecimento junto ao parceiro, cadastradas por academia. Ainda
--    não há integração via API (documentação/credenciais reais pendentes
--    do lado do usuário) — por ora api_key fica disponível para quando a
--    integração automática existir, mas o fluxo atual é 100% manual
--    (recepção confirma o código mostrado no app do visitante).
-- 2. Extensão de acessos_catraca_logs para registrar esses check-ins
--    manuais na mesma tabela/histórico da catraca, em vez de fragmentar
--    em uma tabela separada — mantém o dashboard e os relatórios de
--    frequência (Gestão 360°) unificados.

create table public.organizacao_credenciais_parceiro (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parceiro        text not null check (parceiro in ('wellhub', 'totalpass')),
  identificador   text,
  api_key         text,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, parceiro)
);

create index idx_organizacao_credenciais_parceiro_org on public.organizacao_credenciais_parceiro(organization_id);

alter table public.organizacao_credenciais_parceiro enable row level security;

-- Credenciais são dado sensível (api_key) — restrito a gestor da própria
-- organização e admin_arke, ao contrário de organizacao_catracas (que
-- qualquer staff pode gerenciar). Recepção/professor/nutricionista não
-- enxergam esta tabela; para saber quais parceiros estão ativos, usam a
-- RPC listar_parceiros_externos_ativos abaixo (que não expõe api_key).
create policy "gestor gerencia credenciais de parceiro da propria org"
  on public.organizacao_credenciais_parceiro for all
  to authenticated
  using (public.has_org_role(auth.uid(), organization_id, 'gestor'))
  with check (public.has_org_role(auth.uid(), organization_id, 'gestor'));

create policy "admin_arke gerencia todas as credenciais de parceiro"
  on public.organizacao_credenciais_parceiro for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_role(auth.uid(), 'admin_arke'));

create trigger set_updated_at_organizacao_credenciais_parceiro
  before update on public.organizacao_credenciais_parceiro
  for each row execute function public.set_updated_at();

-- Staff em geral (inclusive recepção) só precisa saber QUAIS parceiros
-- estão ativos para oferecer a opção de check-in — nunca a api_key.
create or replace function public.listar_parceiros_externos_ativos(_organization_id uuid)
returns table (parceiro text)
language sql stable security definer set search_path = public
as $$
  select c.parceiro
  from public.organizacao_credenciais_parceiro c
  where c.organization_id = _organization_id
    and c.ativo = true
    and public.is_org_staff(auth.uid(), _organization_id)
$$;

revoke execute on function public.listar_parceiros_externos_ativos(uuid) from public;
grant execute on function public.listar_parceiros_externos_ativos(uuid) to authenticated;

-- Extensão do log de catraca: check-ins confirmados manualmente pela
-- recepção via parceiro externo. aluno_id fica null nesses casos (o
-- visitante não é necessariamente um `aluno` cadastrado).
alter table public.acessos_catraca_logs
  add column parceiro_externo text check (parceiro_externo in ('wellhub', 'totalpass')),
  add column nome_visitante_externo text,
  add column confirmado_por uuid references auth.users(id) on delete set null;

alter table public.acessos_catraca_logs drop constraint acessos_catraca_logs_resultado_check;
alter table public.acessos_catraca_logs add constraint acessos_catraca_logs_resultado_check
  check (resultado in (
    'liberado',
    'negado_inadimplente',
    'negado_nao_encontrado',
    'negado_catraca_inativa',
    'negado_sem_agendamento',
    'negado_falha_verificacao_agendamento',
    'liberado_parceiro_externo'
  ));
