-- Rodada 4, complementos do onboarding com menos atrito:
--   - canais de suporte (botão "falar com o suporte" em cada etapa);
--   - planos modelo pré-preenchidos, inativos, para a academia conferir o preço;
--   - lembrete por e-mail para onboarding parado;
--   - motivo e data de retorno quando o aluno é pausado.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Textos da plataforma (plataforma_config só guarda números)
-- ─────────────────────────────────────────────────────────────────────────
create table public.plataforma_textos (
  chave text primary key,
  valor text,
  descricao text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.plataforma_textos is
  'Configuração textual global da ArkeFit (canal de suporte etc.). Sem organization_id, como plataforma_config.';

insert into public.plataforma_textos (chave, descricao) values
  ('suporte_whatsapp', 'WhatsApp de suporte da ArkeFit, só dígitos com DDI (ex.: 5511999999999). Sem valor, o botão de WhatsApp não aparece.'),
  ('suporte_email', 'E-mail de suporte da ArkeFit. Sem valor, o botão de e-mail não aparece.');

alter table public.plataforma_textos enable row level security;

-- Canal de suporte é público para quem está logado: é o botão de ajuda.
create policy "leitura" on public.plataforma_textos
  for select to authenticated using (true);
create policy "inclusão" on public.plataforma_textos
  for insert to authenticated
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "alteração" on public.plataforma_textos
  for update to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "exclusão" on public.plataforma_textos
  for delete to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Planos modelo, inativos
-- ─────────────────────────────────────────────────────────────────────────
-- Nascem desligados de propósito: ativos, completariam sozinhos a etapa
-- "Planos" do checklist com um preço que ninguém da academia conferiu.
create or replace function public.seed_planos_academia_modelo()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  insert into public.planos_academia (organization_id, nome, periodicidade, valor, descricao, ativo) values
    (new.id, 'Mensal', 'mensal', 129.90, 'Modelo — confira o valor e ative.', false),
    (new.id, 'Trimestral', 'trimestral', 359.90, 'Modelo — confira o valor e ative.', false),
    (new.id, 'Anual', 'anual', 1199.90, 'Modelo — confira o valor e ative.', false);
  return new;
end;
$$;

create trigger trg_organizations_seed_planos_modelo
  after insert on public.organizations
  for each row execute function public.seed_planos_academia_modelo();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Checklist sem checagem de papel, para o lembrete
-- ─────────────────────────────────────────────────────────────────────────
-- O checklist em si fica numa função interna, sem checagem de papel: a
-- pública confere quem pergunta, e o lembrete roda sem usuário.
create or replace function public.onboarding_etapas_interno(_organization_id uuid)
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

revoke execute on function public.onboarding_etapas_interno(uuid) from public, anon, authenticated;
grant execute on function public.onboarding_etapas_interno(uuid) to service_role;

create or replace function public.get_onboarding_organizacao(_organization_id uuid)
returns table (etapa text, concluida boolean, detalhe text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_org_staff(auth.uid(), _organization_id)
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;
  return query select * from public.onboarding_etapas_interno(_organization_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Lembrete de onboarding parado
-- ─────────────────────────────────────────────────────────────────────────
alter table public.organizations
  add column onboarding_lembrete_em timestamptz,
  add column onboarding_lembretes integer not null default 0;

-- Academias a lembrar: onboarding aberto, fora de trial, criadas há mais de
-- 3 dias e sem lembrete nos últimos 3 dias. Para depois de 5 lembretes — a
-- partir daí é conversa do comercial, não e-mail automático.
create or replace function public.organizacoes_onboarding_parado()
returns table (organization_id uuid, nome text, email text, pendentes text, lembretes int)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id, o.nome,
         coalesce(o.email_contato, (select u.email from public.organization_members m
                                      join auth.users u on u.id = m.user_id
                                     where m.organization_id = o.id and m.role = 'gestor' and m.status = 'active'
                                     order by m.created_at limit 1)),
         (select string_agg(e.etapa, ', ') from public.onboarding_etapas_interno(o.id) e where not e.concluida),
         o.onboarding_lembretes
    from public.organizations o
   where not o.onboarding_completed
     and o.status <> 'trial'
     and o.created_at < now() - interval '3 days'
     and (o.onboarding_lembrete_em is null or o.onboarding_lembrete_em < now() - interval '3 days')
     and o.onboarding_lembretes < 5;
$$;

revoke execute on function public.organizacoes_onboarding_parado() from public, anon, authenticated;
grant execute on function public.organizacoes_onboarding_parado() to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Motivo e retorno da pausa
-- ─────────────────────────────────────────────────────────────────────────
-- Sem motivo, o painel de retenção não diz por que o aluno parou. A data de
-- retorno é a próxima checagem da equipe.
alter table public.alunos
  add column situacao_academia_motivo text,
  add column situacao_academia_retorno date;

create or replace function public.proteger_situacao_aluno()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.situacao_academia is not distinct from old.situacao_academia
     and new.situacao_academia_motivo is not distinct from old.situacao_academia_motivo
     and new.situacao_academia_retorno is not distinct from old.situacao_academia_retorno then
    return new;
  end if;
  if v_uid is not null
     and not (public.has_org_role(v_uid, new.organization_id, 'gestor')
              or public.has_org_role(v_uid, new.organization_id, 'recepcao')
              or public.has_role(v_uid, 'admin_arke')
              or public.has_role(v_uid, 'superadmin')) then
    raise exception 'Só o gestor ou a recepção alteram a situação do aluno.' using errcode = '42501';
  end if;
  -- Em dia não tem motivo nem retorno: a pausa acabou.
  if new.situacao_academia = 'em_dia' then
    new.situacao_academia_motivo := null;
    new.situacao_academia_retorno := null;
  end if;
  if new.situacao_academia is distinct from old.situacao_academia then
    new.situacao_academia_em := now();
    new.situacao_academia_por := v_uid;
  end if;
  return new;
end;
$$;
