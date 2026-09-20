-- Trilha de auditoria das ações sensíveis da plataforma.
--
-- Hoje suspender um tenant, resetar o token das catracas de uma unidade,
-- trocar o e-mail de login do gestor, excluir uma organização inteira (com
-- cascade em alunos, treinos, dietas e cobranças) e simular o perfil de
-- outra pessoa não deixam rastro nenhum. Este log passa a registrar quem
-- fez, em quem, quando e o quê.

-- ---------------------------------------------------------------------
-- 1) Tabela
-- ---------------------------------------------------------------------
create table if not exists public.auditoria_acoes_sensiveis (
  id uuid primary key default gen_random_uuid(),
  -- Nulo = escrita sem contexto de sessão (serviço). A UI mostra isso como
  -- "sistema" em vez de fingir que sabe quem foi.
  ator_user_id uuid,
  -- Desnormalizado de propósito: o ator pode ser excluído depois, e um log
  -- que perde o nome de quem agiu não serve para auditoria.
  ator_email text,
  acao text not null,
  entidade text not null,
  -- Sem FOREIGN KEY de propósito: a exclusão de organização é justamente a
  -- ação mais importante de auditar. Com FK + cascade, a linha do log
  -- sumiria junto com o que ela documenta.
  entidade_id uuid,
  organizacao_nome text,
  detalhes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_auditoria_data on public.auditoria_acoes_sensiveis (created_at desc);
create index if not exists idx_auditoria_acao on public.auditoria_acoes_sensiveis (acao, created_at desc);
create index if not exists idx_auditoria_ator on public.auditoria_acoes_sensiveis (ator_user_id, created_at desc);

alter table public.auditoria_acoes_sensiveis enable row level security;

drop policy if exists "superadmin lê a auditoria" on public.auditoria_acoes_sensiveis;
create policy "superadmin lê a auditoria"
  on public.auditoria_acoes_sensiveis for select
  using (has_role((select auth.uid()), 'superadmin'::app_role));
-- Sem policy de INSERT/UPDATE/DELETE: ninguém escreve nem apaga pelo
-- client. Só registrar_auditoria() (SECURITY DEFINER) grava.

-- ---------------------------------------------------------------------
-- 2) Função de registro
-- ---------------------------------------------------------------------
-- Um ponto único de escrita, usado tanto pelos triggers quanto pelas edge
-- functions. Resolve o e-mail do ator aqui para o chamador não precisar
-- fazer essa consulta.
create or replace function public.registrar_auditoria(
  _ator_user_id uuid,
  _acao text,
  _entidade text,
  _entidade_id uuid,
  _organizacao_nome text,
  _detalhes jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if _ator_user_id is not null then
    select u.email into v_email from auth.users u where u.id = _ator_user_id;
  end if;

  insert into public.auditoria_acoes_sensiveis
    (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  values
    (_ator_user_id, v_email, _acao, _entidade, _entidade_id, _organizacao_nome,
     coalesce(_detalhes, '{}'::jsonb));
end;
$$;

-- Escrever no log de auditoria não é operação de usuário final: quem chama
-- é trigger (internamente) ou edge function com service_role.
revoke all on function public.registrar_auditoria(uuid, text, text, uuid, text, jsonb) from public;
revoke all on function public.registrar_auditoria(uuid, text, text, uuid, text, jsonb) from anon;
revoke all on function public.registrar_auditoria(uuid, text, text, uuid, text, jsonb) from authenticated;
grant execute on function public.registrar_auditoria(uuid, text, text, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 3) Trigger de alteração de organização
-- ---------------------------------------------------------------------
-- Cobre o caminho da UI do Super Admin, que atualiza organizations direto
-- pelo PostgREST com o JWT do próprio superadmin — por isso auth.uid()
-- aqui é o ator de verdade.
--
-- Não há trigger de DELETE de propósito: a exclusão só acontece pela edge
-- function superadmin-suporte-tenant, que roda com service_role (auth.uid()
-- nulo) e registra a própria linha já com o ator correto. Um trigger de
-- DELETE geraria uma segunda linha, sem ator, para o mesmo evento.
create or replace function public.auditar_organizacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detalhes jsonb := '{}'::jsonb;
  v_acao text;
begin
  if new.status is distinct from old.status then
    v_detalhes := v_detalhes || jsonb_build_object(
      'status', jsonb_build_object('de', old.status, 'para', new.status));
  end if;
  if new.plano_b2b is distinct from old.plano_b2b then
    v_detalhes := v_detalhes || jsonb_build_object(
      'plano_b2b', jsonb_build_object('de', old.plano_b2b, 'para', new.plano_b2b));
  end if;
  if new.nome is distinct from old.nome then
    v_detalhes := v_detalhes || jsonb_build_object(
      'nome', jsonb_build_object('de', old.nome, 'para', new.nome));
  end if;
  if new.tipo is distinct from old.tipo then
    v_detalhes := v_detalhes || jsonb_build_object(
      'tipo', jsonb_build_object('de', old.tipo, 'para', new.tipo));
  end if;
  if new.cnpj_cpf is distinct from old.cnpj_cpf then
    v_detalhes := v_detalhes || jsonb_build_object('cnpj_cpf', 'alterado');
  end if;
  if new.trial_vencimento is distinct from old.trial_vencimento then
    v_detalhes := v_detalhes || jsonb_build_object(
      'trial_vencimento', jsonb_build_object('de', old.trial_vencimento, 'para', new.trial_vencimento));
  end if;

  -- Toda escrita em organizations passa pelo trigger de updated_at; sem
  -- esta saída, cada toque geraria uma linha de auditoria vazia.
  if v_detalhes = '{}'::jsonb then
    return null;
  end if;

  -- A ação nomeia o fato mais grave do update; o diff completo fica em
  -- detalhes. Isso é o que torna o log escaneável de relance.
  v_acao := case
    when new.status is distinct from old.status and new.status = 'suspenso' then 'organizacao.suspensa'
    when new.status is distinct from old.status and new.status = 'cancelado' then 'organizacao.cancelada'
    when new.status is distinct from old.status and new.status = 'ativo' then 'organizacao.reativada'
    when new.status is distinct from old.status then 'organizacao.status_alterado'
    else 'organizacao.alterada'
  end;

  perform public.registrar_auditoria(
    auth.uid(), v_acao, 'organizations', new.id, new.nome, v_detalhes);

  return null;
end;
$$;

revoke all on function public.auditar_organizacao() from public;
revoke all on function public.auditar_organizacao() from anon;
revoke all on function public.auditar_organizacao() from authenticated;

drop trigger if exists trg_organizations_auditoria on public.organizations;
create trigger trg_organizations_auditoria
  after update on public.organizations
  for each row execute function public.auditar_organizacao();
