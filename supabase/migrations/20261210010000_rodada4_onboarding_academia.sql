-- Rodada 4 dos ajustes do app original: onboarding da academia em etapas,
-- conta Asaas criada pela API (ou informada, se a academia já tem uma) e
-- mensalidade B2B recorrente.
--
-- Decisões de 22/09/2026:
--   D5  a academia usa o painel normalmente (cadastra, prescreve, importa),
--       mas alunos no app e cobranças só são liberados com todas as etapas
--       concluídas.
--   D6  aceitar os dois caminhos: o ARKE cria a conta Asaas da academia pela
--       API, ou a academia que já tem conta informa a identificação (walletId).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Dados cadastrais e conta Asaas da academia
-- ─────────────────────────────────────────────────────────────────────────
alter table public.organizations
  add column razao_social text,
  add column email_contato text,
  add column cep text,
  add column logradouro text,
  add column numero text,
  add column complemento text,
  add column bairro text,
  add column cidade text,
  add column uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  add column tipo_empresa text check (tipo_empresa is null or tipo_empresa in ('MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION')),
  add column faturamento_mensal numeric check (faturamento_mensal is null or faturamento_mensal > 0),
  add column asaas_conta_origem text check (asaas_conta_origem is null or asaas_conta_origem in ('criada', 'existente')),
  add column asaas_conta_id text,
  add column asaas_conta_status text,
  add column asaas_conta_status_em timestamptz,
  add column onboarding_equipe_dispensada boolean not null default false,
  add column onboarding_concluido_em timestamptz,
  add column valor_mensal_b2b numeric check (valor_mensal_b2b is null or valor_mensal_b2b > 0),
  add column asaas_subscription_id_b2b text;

comment on column public.organizations.asaas_conta_origem is
  'criada = subconta aberta pelo ARKE (POST /accounts), cuja chave fica no Vault; existente = a academia já tinha conta e informou o walletId.';
comment on column public.organizations.asaas_conta_status is
  'Situação geral da subconta no Asaas (GET /myAccount/status, campo general): PENDING, AWAITING_APPROVAL, APPROVED ou REJECTED.';
comment on column public.organizations.valor_mensal_b2b is
  'Mensalidade B2B negociada. Sem valor, vale o preço do plano em planos_b2b_precos (obrigatório no Custom).';

-- Mensalidade B2B por assinatura: a fatura sai com o tipo escolhido pela
-- academia na página do Asaas (UNDEFINED), não só PIX ou cartão.
alter table public.cobrancas_b2b drop constraint cobrancas_b2b_forma_pagamento_check;
alter table public.cobrancas_b2b add constraint cobrancas_b2b_forma_pagamento_check
  check (forma_pagamento in ('PIX', 'CREDIT_CARD', 'BOLETO', 'UNDEFINED'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Preço dos planos B2B (até aqui só existia no CLAUDE.md)
-- ─────────────────────────────────────────────────────────────────────────
create table public.planos_b2b_precos (
  plano public.plano_b2b primary key,
  valor_mensal numeric check (valor_mensal is null or valor_mensal > 0),
  limite_alunos integer check (limite_alunos is null or limite_alunos > 0),
  updated_at timestamptz not null default now()
);

comment on table public.planos_b2b_precos is
  'Tabela de preço da assinatura B2B. Configuração global da ArkeFit (sem organization_id, como planos_atacado). Custom e autônomo não têm preço de tabela: o valor vai em organizations.valor_mensal_b2b.';

insert into public.planos_b2b_precos (plano, valor_mensal, limite_alunos) values
  ('starter', 390, 150),
  ('growth', 790, 500),
  ('enterprise', 1290, 1000),
  ('custom', null, null),
  ('autonomo', null, null);

alter table public.planos_b2b_precos enable row level security;

create policy "leitura" on public.planos_b2b_precos
  for select to authenticated using (true);
create policy "inclusão" on public.planos_b2b_precos
  for insert to authenticated
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "alteração" on public.planos_b2b_precos
  for update to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "exclusão" on public.planos_b2b_precos
  for delete to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));

create or replace function public.valor_mensal_b2b(_organization_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(o.valor_mensal_b2b, p.valor_mensal)
    from public.organizations o
    left join public.planos_b2b_precos p on p.plano = o.plano_b2b
   where o.id = _organization_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Trava por coluna em organizations
-- ─────────────────────────────────────────────────────────────────────────
-- A política de UPDATE deixa o gestor alterar qualquer coluna da própria
-- organização. Para nome, telefone e endereço é o certo; para o que mexe em
-- dinheiro ou em contrato, não: um gestor podia se dar o plano Enterprise,
-- subir o próprio limite de alunos, trocar a carteira que recebe o split ou
-- marcar o onboarding como concluído sem concluir. Contexto sem usuário
-- (service_role: as edge functions do Asaas) passa — elas conferem o papel.
create or replace function public.proteger_colunas_organizacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_arkefit boolean;
begin
  if v_uid is null then
    return new;
  end if;
  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if v_arkefit then
    return new;
  end if;

  if new.plano_b2b is distinct from old.plano_b2b
     or new.limite_alunos is distinct from old.limite_alunos
     or new.valor_mensal_b2b is distinct from old.valor_mensal_b2b
     or new.asaas_subscription_id_b2b is distinct from old.asaas_subscription_id_b2b
     or new.asaas_customer_id_b2b is distinct from old.asaas_customer_id_b2b then
    raise exception 'Plano, limite de alunos e mensalidade B2B são definidos pela ArkeFit.' using errcode = '42501';
  end if;

  if new.asaas_wallet_id is distinct from old.asaas_wallet_id
     or new.asaas_conta_id is distinct from old.asaas_conta_id
     or new.asaas_conta_origem is distinct from old.asaas_conta_origem
     or new.asaas_conta_status is distinct from old.asaas_conta_status then
    raise exception 'A conta Asaas da academia é configurada pelo onboarding (Recebimentos), que confere a carteira antes de gravar.' using errcode = '42501';
  end if;

  if new.onboarding_completed is distinct from old.onboarding_completed
     and coalesce(current_setting('arke.concluindo_onboarding', true), '') <> 'sim' then
    raise exception 'O onboarding é concluído pelo checklist, quando todas as etapas estiverem prontas.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_proteger_colunas_organizacao
  before update on public.organizations
  for each row execute function public.proteger_colunas_organizacao();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Checklist do onboarding
-- ─────────────────────────────────────────────────────────────────────────
-- As etapas são lidas do estado real, não marcadas à mão: "dados" está pronta
-- quando os campos que o Asaas exige estão preenchidos, "planos" quando existe
-- plano ativo, e assim por diante. Só a equipe tem dispensa explícita — studio
-- de um profissional só não tem equipe para cadastrar.
create or replace function public.get_onboarding_organizacao(_organization_id uuid)
returns table (etapa text, concluida boolean, detalhe text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  o public.organizations%rowtype;
  v_doc text;
  v_faltando text[] := '{}';
  v_n int;
begin
  if not (public.is_org_staff(auth.uid(), _organization_id)
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  select * into o from public.organizations where id = _organization_id;
  if not found then
    return;
  end if;

  v_doc := regexp_replace(coalesce(o.cnpj_cpf, ''), '\D', '', 'g');
  if length(v_doc) not in (11, 14) then v_faltando := array_append(v_faltando, 'CNPJ'); end if;
  if length(v_doc) = 14 and coalesce(btrim(o.razao_social), '') = '' then v_faltando := array_append(v_faltando, 'razão social'); end if;
  if coalesce(btrim(o.email_contato), '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then v_faltando := array_append(v_faltando, 'e-mail'); end if;
  if length(regexp_replace(coalesce(o.telefone, ''), '\D', '', 'g')) < 10 then v_faltando := array_append(v_faltando, 'celular'); end if;
  if length(regexp_replace(coalesce(o.cep, ''), '\D', '', 'g')) <> 8 then v_faltando := array_append(v_faltando, 'CEP'); end if;
  if coalesce(btrim(o.logradouro), '') = '' or coalesce(btrim(o.numero), '') = '' or coalesce(btrim(o.bairro), '') = ''
     or coalesce(btrim(o.cidade), '') = '' or o.uf is null then
    v_faltando := array_append(v_faltando, 'endereço');
  end if;
  etapa := 'dados';
  concluida := cardinality(v_faltando) = 0;
  detalhe := case when concluida then null else 'Falta: ' || array_to_string(v_faltando, ', ') end;
  return next;

  etapa := 'recebimentos';
  concluida := o.asaas_wallet_id is not null;
  detalhe := case
    when o.asaas_wallet_id is null then 'Conta Asaas ainda não configurada'
    when o.asaas_conta_origem = 'criada' and coalesce(o.asaas_conta_status, '') <> 'APPROVED'
      then 'Conta criada — aprovação do Asaas: ' || coalesce(o.asaas_conta_status, 'aguardando')
    else null
  end;
  return next;

  select count(*) into v_n from public.planos_academia where organization_id = _organization_id and ativo;
  etapa := 'planos';
  concluida := v_n > 0;
  detalhe := case when v_n > 0 then v_n || ' plano(s) ativo(s)' else 'Nenhum plano ativo' end;
  return next;

  select count(*) into v_n from public.organization_members
   where organization_id = _organization_id and status = 'active' and role in ('professor', 'nutricionista', 'recepcao');
  etapa := 'equipe';
  concluida := v_n > 0 or o.onboarding_equipe_dispensada;
  detalhe := case when v_n > 0 then v_n || ' pessoa(s) na equipe'
                  when o.onboarding_equipe_dispensada then 'Sem equipe além do gestor'
                  else 'Nenhum membro cadastrado' end;
  return next;

  select count(*) into v_n from public.alunos where organization_id = _organization_id and anonimizado_em is null;
  etapa := 'alunos';
  concluida := v_n > 0;
  detalhe := case when v_n > 0 then v_n || ' aluno(s)' else 'Nenhum aluno cadastrado' end;
  return next;
end;
$$;

revoke execute on function public.get_onboarding_organizacao(uuid) from public, anon;
grant execute on function public.get_onboarding_organizacao(uuid) to authenticated;

-- Conclui quando tudo está pronto. É o único caminho que liga
-- onboarding_completed para o gestor (a trava acima recusa o UPDATE direto).
create or replace function public.concluir_onboarding_organizacao(_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pendentes text;
begin
  if not (public.has_org_role(auth.uid(), _organization_id, 'gestor')
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Só o gestor conclui o onboarding da academia.' using errcode = '42501';
  end if;

  select string_agg(etapa, ', ') into v_pendentes
    from public.get_onboarding_organizacao(_organization_id) where not concluida;
  if v_pendentes is not null then
    raise exception 'Ainda há etapas pendentes: %.', v_pendentes using errcode = '23514';
  end if;

  perform set_config('arke.concluindo_onboarding', 'sim', true);
  update public.organizations
     set onboarding_completed = true,
         onboarding_concluido_em = coalesce(onboarding_concluido_em, now())
   where id = _organization_id;
  perform set_config('arke.concluindo_onboarding', '', true);
  return true;
end;
$$;

revoke execute on function public.concluir_onboarding_organizacao(uuid) from public, anon;
grant execute on function public.concluir_onboarding_organizacao(uuid) to authenticated;

-- D5: alunos no app e cobranças só com o onboarding concluído. Organização em
-- trial é homologação e não passa por aqui.
create or replace function public.organizacao_liberada(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select o.onboarding_completed or o.status = 'trial' from public.organizations o where o.id = _organization_id), false);
$$;

grant execute on function public.organizacao_liberada(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Chave da subconta Asaas, no Vault
-- ─────────────────────────────────────────────────────────────────────────
-- O Asaas entrega a chave da subconta uma única vez, na criação, e ela é o
-- único jeito de consultar a situação cadastral (GET /myAccount/status). Fica
-- no Vault, cifrada, e só a service_role (as edge functions) grava e lê.
create or replace function public.guardar_chave_subconta_asaas(_organization_id uuid, _chave text)
returns void
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_nome text := 'asaas_subconta:' || _organization_id::text;
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = v_nome;
  if v_id is null then
    perform vault.create_secret(_chave, v_nome, 'Chave da subconta Asaas da academia (criada pelo onboarding)');
  else
    perform vault.update_secret(v_id, _chave);
  end if;
end;
$$;

create or replace function public.ler_chave_subconta_asaas(_organization_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'vault'
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'asaas_subconta:' || _organization_id::text;
$$;

revoke execute on function public.guardar_chave_subconta_asaas(uuid, text) from public, anon, authenticated;
revoke execute on function public.ler_chave_subconta_asaas(uuid) from public, anon, authenticated;
grant execute on function public.guardar_chave_subconta_asaas(uuid, text) to service_role;
grant execute on function public.ler_chave_subconta_asaas(uuid) to service_role;
