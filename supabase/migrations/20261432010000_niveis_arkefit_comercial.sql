-- Os níveis da equipe da ArkeFit, lote 5: o Comercial (08/10/2026).
--
-- O Comercial contratado trabalha duas áreas da Visão Master:
--   * `comercial`: o Pipeline (os contatos e o que a Letícia mandou a cada
--     um), acionar a Letícia num contato e o funil de conversão das
--     academias. Ligar e desligar a Letícia (`definir_agente_comercial`)
--     continua do Sócio;
--   * `cadastro`: a academia nova (só `ativo`: o trial é homologação, do
--     Sócio; a função `criar-organizacao-superadmin` confere), o nome, o tipo,
--     o CNPJ e o telefone da academia, e o convite e a edição do profissional
--     autônomo.
-- Ele abre também a carteira (lote 4): a lista das academias, sem dinheiro.
-- Não vê dinheiro de academia, dado de aluno nem a equipe.
--
-- O cadastro da academia passa por uma função nova,
-- `atualizar_cadastro_organizacao`, e não pela regra de alteração de
-- `organizations`, que continua do Sócio (e do gestor, na própria academia):
-- abrir a regra ao Comercial abriria todas as colunas, inclusive o status, o
-- plano e a carteira, e a trava das colunas olha só algumas.
--
-- Cada função troca o papel (superadmin, ou superadmin e admin_arke) pela
-- área (`acesso_arkefit`), que o Sócio abre sempre. O texto de cada uma é o
-- da última migration que a definiu; muda só a conferência de quem chama, e a
-- recusa passa a ter o código 42501.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. O nível Comercial está no ar
-- ---------------------------------------------------------------------------
create or replace function public.niveis_arkefit_abertos()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['mentor', 'suporte', 'comercial']::text[];
$$;

-- ---------------------------------------------------------------------------
-- 2. O Pipeline: uma regra por operação, só a área `comercial`
-- ---------------------------------------------------------------------------
-- As regras de leitura e de alteração nasceram com a tabela (`leads_site`,
-- 20261288010000) e as de inclusão e de exclusão vieram em 20261301010000.
-- São recriadas (e não alteradas) porque o leitor das regras das guardas não
-- acompanha a troca do nome da tabela. As permissões por coluna
-- (20261301010000) e o gatilho `proteger_lead_comercial` não mudam.
drop policy if exists "leitura" on public.leads_comerciais;
create policy "leitura" on public.leads_comerciais for select to authenticated
  using ((select public.acesso_arkefit('comercial')));

drop policy if exists "inclusão" on public.leads_comerciais;
create policy "inclusão" on public.leads_comerciais for insert to authenticated
  with check ((select public.acesso_arkefit('comercial')));

drop policy if exists "alteração" on public.leads_comerciais;
create policy "alteração" on public.leads_comerciais for update to authenticated
  using ((select public.acesso_arkefit('comercial')))
  with check ((select public.acesso_arkefit('comercial')));

drop policy if exists "exclusão" on public.leads_comerciais;
create policy "exclusão" on public.leads_comerciais for delete to authenticated
  using ((select public.acesso_arkefit('comercial')));

-- O que a Letícia mandou a cada contato: só leitura. Quem escreve é a função
-- dela, pela service role.
drop policy if exists "leitura" on public.leads_comerciais_mensagens;
create policy "leitura" on public.leads_comerciais_mensagens for select to authenticated
  using ((select public.acesso_arkefit('comercial')));

-- ---------------------------------------------------------------------------
-- 3. Acionar a Letícia num contato (o texto de 20261301010000)
-- ---------------------------------------------------------------------------
create or replace function public.acionar_agente_comercial(_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  l public.leads_comerciais%rowtype;
begin
  if not public.acesso_arkefit('comercial') then
    raise exception 'Só a equipe comercial da ArkeFit aciona a Letícia.' using errcode = '42501';
  end if;

  select * into l from public.leads_comerciais where id = _lead_id for update;
  if not found then
    raise exception 'Contato não encontrado.' using errcode = 'P0002';
  end if;
  if l.origem = 'site' then
    raise exception 'Contato do site já recebe a resposta da Letícia sozinho.' using errcode = '22023';
  end if;
  if l.agente_acionado_em is not null then
    return;
  end if;
  if l.status <> 'novo' then
    raise exception 'A Letícia só fala com contatos em Novos. Volte o cartão para Novos antes de acionar.' using errcode = '22023';
  end if;
  if l.email is null then
    raise exception 'Cadastre o e-mail do contato: a Letícia escreve por e-mail.' using errcode = '22023';
  end if;
  if l.agente_parou_em is not null then
    raise exception 'Este contato pediu para não receber mais e-mails, ou o endereço não existe.' using errcode = '22023';
  end if;
  if not coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_comercial_ativo'), false) then
    raise exception 'A Letícia está desligada. Ligue-a no painel da resposta automática (precisa do link da agenda).' using errcode = '22023';
  end if;
  if not coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_comercial_outras_origens'), false) then
    raise exception 'A Letícia só fala com contatos do site até a Política de Privacidade descrever os outros canais.' using errcode = '22023';
  end if;

  update public.leads_comerciais
     set agente_acionado_em = now(), agente_acionado_por = v_uid
   where id = _lead_id;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  select v_uid, u.email, 'agente_comercial.acionar', 'leads_comerciais', _lead_id,
         jsonb_build_object('origem', l.origem)
    from (select 1) um
    left join auth.users u on u.id = v_uid;
end;
$$;

revoke execute on function public.acionar_agente_comercial(uuid) from public, anon;
grant execute on function public.acionar_agente_comercial(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. O funil de conversão (os textos de 20261107010000)
-- ---------------------------------------------------------------------------
-- Contagens das academias por mês de entrada e por situação: nenhum valor,
-- nenhum dado de aluno.
create or replace function public.get_superadmin_funil_conversao(_meses integer default 12)
returns table (
  safra date,
  total_entradas bigint,
  em_trial bigint,
  ativos bigint,
  inadimplentes bigint,
  suspensos bigint,
  cancelados bigint,
  taxa_conversao_pct numeric,
  taxa_churn_pct numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_meses integer := least(greatest(coalesce(_meses, 12), 1), 36);
begin
  if not public.acesso_arkefit('comercial') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
  end if;

  return query
  with meses as (
    select generate_series(
             date_trunc('month', current_date) - make_interval(months => v_meses - 1),
             date_trunc('month', current_date),
             interval '1 month'
           )::date as safra
  ),
  orgs as (
    select date_trunc('month', created_at)::date as safra, status
      from public.organizations
  )
  select
    m.safra,
    -- count(o.status) e não count(*): no LEFT JOIN sem match, count(*)
    -- contaria a linha nula e todo mês vazio viraria "1 entrada".
    count(o.status) as total_entradas,
    count(*) filter (where o.status = 'trial') as em_trial,
    count(*) filter (where o.status = 'ativo') as ativos,
    count(*) filter (where o.status = 'inadimplente') as inadimplentes,
    count(*) filter (where o.status = 'suspenso') as suspensos,
    count(*) filter (where o.status = 'cancelado') as cancelados,
    case when count(o.status) > 0
      then round(count(*) filter (where o.status = 'ativo')::numeric / count(o.status) * 100, 1)
      else 0 end as taxa_conversao_pct,
    case when count(o.status) > 0
      then round(count(*) filter (where o.status = 'cancelado')::numeric / count(o.status) * 100, 1)
      else 0 end as taxa_churn_pct
  from meses m
  left join orgs o on o.safra = m.safra
  group by m.safra
  order by m.safra;
end;
$$;

create or replace function public.get_superadmin_funil_sinais()
returns table (
  trials_total bigint,
  trials_sem_prazo bigint,
  trials_vencidos bigint,
  inadimplentes bigint,
  suspensos bigint,
  transicoes_30d bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.acesso_arkefit('comercial') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.organizations where status = 'trial'),
    -- Trial sem data limite não vence, não cobra e não gera nenhuma
    -- pendência: fica parado até alguém lembrar dele na mão.
    (select count(*) from public.organizations
      where status = 'trial' and trial_vencimento is null),
    (select count(*) from public.organizations
      where status = 'trial' and trial_vencimento is not null
        and trial_vencimento < current_date),
    (select count(*) from public.organizations where status = 'inadimplente'),
    (select count(*) from public.organizations where status = 'suspenso'),
    (select count(*) from public.organizacao_status_historico
      where status_anterior is not null
        and created_at >= now() - interval '30 days');
end;
$$;

revoke execute on function public.get_superadmin_funil_conversao(integer) from public, anon;
grant execute on function public.get_superadmin_funil_conversao(integer) to authenticated;
revoke execute on function public.get_superadmin_funil_sinais() from public, anon;
grant execute on function public.get_superadmin_funil_sinais() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. O cadastro da academia: nome, tipo, CNPJ e telefone
-- ---------------------------------------------------------------------------
-- Só estas quatro colunas; o resto da academia (o status, o trial, o plano,
-- a mensalidade, o repasse, a carteira) tem dono próprio. A auditoria do nome,
-- do tipo e do CNPJ sai do gatilho `trg_organizations_auditoria`, como saía no
-- update direto, com quem chamou. Converter em profissional autônomo (ou
-- desfazer) é do Sócio: o painel do autônomo tem especialidade e parceria
-- próprias (o gatilho `prevent_gestor_tipo_para_autonomo` já recusava a
-- conversão a quem não é da ArkeFit). O CNPJ e o telefone são conferidos só
-- quando mudam: a academia com um valor antigo fora do formato não fica
-- presa na hora de trocar o nome.
create or replace function public.atualizar_cadastro_organizacao(
  _organization_id uuid,
  _nome text,
  _tipo public.organization_tipo,
  _cnpj_cpf text,
  _telefone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_nome text := nullif(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), '');
  v_cnpj text := nullif(btrim(coalesce(_cnpj_cpf, '')), '');
  v_tel text := nullif(btrim(coalesce(_telefone, '')), '');
begin
  if not public.acesso_arkefit('cadastro') then
    raise exception 'Só a equipe da ArkeFit com acesso ao cadastro altera os dados da academia.' using errcode = '42501';
  end if;

  select * into v_org from public.organizations where id = _organization_id for update;
  if v_org.id is null then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe o nome da academia (de 2 a 120 letras).' using errcode = '22023';
  end if;
  if _tipo is null then
    raise exception 'Informe o tipo de negócio.' using errcode = '22023';
  end if;
  if _tipo is distinct from v_org.tipo
     and 'profissional_autonomo' in (_tipo, v_org.tipo)
     and not public.acesso_arkefit('socio') then
    raise exception 'Converter em profissional autônomo, ou desfazer, é de um sócio da ArkeFit.' using errcode = '42501';
  end if;
  if v_cnpj is distinct from v_org.cnpj_cpf and v_cnpj is not null
     and length(regexp_replace(v_cnpj, '\D', '', 'g')) not in (11, 14) then
    raise exception 'CNPJ ou CPF inválido: use os 14 dígitos do CNPJ ou os 11 do CPF.' using errcode = '22023';
  end if;
  if v_tel is distinct from v_org.telefone and v_tel is not null
     and length(regexp_replace(v_tel, '\D', '', 'g')) not between 10 and 13 then
    raise exception 'Telefone inválido: use o DDD e o número.' using errcode = '22023';
  end if;

  update public.organizations
     set nome = v_nome,
         tipo = _tipo,
         cnpj_cpf = v_cnpj,
         telefone = v_tel
   where id = _organization_id
     and (nome, tipo, cnpj_cpf, telefone) is distinct from (v_nome, _tipo, v_cnpj, v_tel);
end;
$$;

comment on function public.atualizar_cadastro_organizacao(uuid, text, public.organization_tipo, text, text) is
  'O cadastro da academia (nome, tipo, CNPJ e telefone), pela área cadastro da equipe ArkeFit (o Comercial) e pelo Sócio. A regra de alteração de organizations continua do Sócio e do gestor.';

revoke execute on function public.atualizar_cadastro_organizacao(uuid, text, public.organization_tipo, text, text) from public, anon;
grant execute on function public.atualizar_cadastro_organizacao(uuid, text, public.organization_tipo, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Editar o profissional autônomo (o texto de 20261317010000)
-- ---------------------------------------------------------------------------
create or replace function public.atualizar_profissional_autonomo(
  _organization_id uuid,
  _nome text,
  _especialidade public.app_role,
  _responsavel_nome text default null,
  _responsavel_telefone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_gestor uuid;
  v_nome text := nullif(btrim(coalesce(_nome, '')), '');
  v_resp text := nullif(btrim(coalesce(_responsavel_nome, '')), '');
  v_tel text := nullif(btrim(coalesce(_responsavel_telefone, '')), '');
begin
  if not public.acesso_arkefit('cadastro') then
    raise exception 'Só a equipe da ArkeFit com acesso ao cadastro edita o painel do profissional.' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = _organization_id for update;
  if v_org.id is null or v_org.tipo <> 'profissional_autonomo' then
    raise exception 'Painel de profissional não encontrado.' using errcode = 'P0002';
  end if;
  if v_nome is null then
    raise exception 'Informe o nome do painel.' using errcode = '22023';
  end if;
  if length(v_nome) > 120 then
    raise exception 'O nome do painel tem no máximo 120 caracteres.' using errcode = '22023';
  end if;
  if _especialidade is null or _especialidade not in ('professor', 'nutricionista') then
    raise exception 'A especialidade é Personal Trainer ou Nutricionista.' using errcode = '22023';
  end if;
  if _especialidade is distinct from v_org.especialidade_profissional and exists (
    select 1 from public.organization_members m
     where m.organization_id = _organization_id and m.status = 'active' and m.role in ('professor', 'nutricionista')
  ) then
    raise exception 'Encerre a parceria antes de trocar a especialidade: o parceiro foi convidado para a outra parte.'
      using errcode = '22023';
  end if;
  if v_tel is not null and length(regexp_replace(v_tel, '\D', '', 'g')) not between 10 and 13 then
    raise exception 'Telefone inválido: use o DDD e o número.' using errcode = '22023';
  end if;

  update public.organizations
     set nome = v_nome, especialidade_profissional = _especialidade
   where id = _organization_id;

  select m.user_id into v_gestor from public.organization_members m
   where m.organization_id = _organization_id and m.role = 'gestor' and m.status = 'active'
   order by m.created_at
   limit 1;
  if v_gestor is not null then
    update public.profiles
       set full_name = coalesce(v_resp, full_name),
           phone = v_tel
     where user_id = v_gestor;
  end if;

  perform public.registrar_auditoria(
    auth.uid(), 'profissional.editado', 'organizations', _organization_id, v_nome,
    jsonb_build_object(
      'nome_anterior', v_org.nome,
      'especialidade', _especialidade,
      'especialidade_anterior', v_org.especialidade_profissional,
      'responsavel_editado', v_gestor is not null
    )
  );
end;
$$;

revoke execute on function public.atualizar_profissional_autonomo(uuid, text, public.app_role, text, text) from public, anon;
grant execute on function public.atualizar_profissional_autonomo(uuid, text, public.app_role, text, text) to authenticated;
