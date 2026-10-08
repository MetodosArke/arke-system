-- Os níveis da equipe da ArkeFit, lote 4: o Suporte (08/10/2026).
--
-- O Suporte contratado atende as academias pela Visão Master, em três áreas:
--   * `carteira`: as academias e os autônomos, sem dinheiro. A lista das
--     academias (`get_superadmin_tenants`) devolve o MRR e as assinaturas
--     atrasadas só a quem abre `financeiro`; para o Suporte, as duas colunas
--     voltam nulas. A operação global vai em contagens;
--   * `suporte`: os chamados e as avaliações do atendimento, os números do
--     assistente e a implantação (os chamados do Bruno);
--   * `operacao`: os equipamentos (as catracas, os acessos e a biometria em
--     contagem), o Vigia só para ler, as rotinas e a capacidade do banco. O
--     reset do token do Gateway mora na função `superadmin-suporte-tenant`.
-- O resto continua do Sócio: as ações do Vigia (aprovar, dispensar, ligar,
-- mudar o modo), a atividade detalhada da academia (traz saúde: o treino, a
-- dieta e a avaliação de cada aluno), a simulação, o trial, o e-mail do
-- gestor, excluir e encerrar academia.
--
-- Cada função troca o papel (`has_role` superadmin, ou superadmin e
-- admin_arke) pela área (`acesso_arkefit`), que o Sócio abre sempre. O texto
-- de cada uma é o da última migration que a definiu; muda só a conferência
-- de quem chama, e a recusa passa a ter o código 42501 em todas.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. O nível Suporte está no ar
-- ---------------------------------------------------------------------------
create or replace function public.niveis_arkefit_abertos()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['mentor', 'suporte']::text[];
$$;

-- ---------------------------------------------------------------------------
-- 2. A carteira, sem dinheiro para quem não abre `financeiro`
-- ---------------------------------------------------------------------------
-- O texto de 20261026010000.
create or replace function public.get_superadmin_tenants()
returns table (
  organization_id       uuid,
  nome                   text,
  slug                   text,
  status                 public.org_status,
  plano_b2b              public.plano_b2b,
  tipo                   public.organization_tipo,
  created_at             timestamptz,
  alunos_total           bigint,
  mrr_organizacao        numeric,
  assinaturas_atrasadas  bigint,
  ultima_atividade       timestamptz,
  cnpj_cpf               text,
  telefone               text,
  trial_vencimento       date,
  gestor_email           text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dinheiro boolean;
begin
  if not public.acesso_arkefit('carteira') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
  end if;
  -- O MRR e as assinaturas atrasadas são do Financeiro (e do Sócio).
  v_dinheiro := public.acesso_arkefit('financeiro');

  return query
  select
    o.id as organization_id,
    o.nome,
    o.slug,
    o.status,
    o.plano_b2b,
    o.tipo,
    o.created_at,
    (select count(*) from public.alunos a where a.organization_id = o.id) as alunos_total,
    case when v_dinheiro then
      coalesce((select sum(s.valor_cobrado) from public.aluno_assinaturas s
                where s.organization_id = o.id and s.status = 'ativa'), 0)
      + coalesce((select sum(
          case p.periodicidade
            when 'mensal' then m.valor_cobrado
            when 'trimestral' then m.valor_cobrado / 3
            when 'semestral' then m.valor_cobrado / 6
            when 'anual' then m.valor_cobrado / 12
          end
        ) from public.aluno_matriculas_academia m
        join public.planos_academia p on p.id = m.plano_id
        where m.organization_id = o.id and m.status = 'ativa'), 0)
    end as mrr_organizacao,
    case when v_dinheiro then
      (select count(*) from public.aluno_assinaturas s
        where s.organization_id = o.id and s.status = 'atrasada')
      + (select count(*) from public.mensalidades me
        where me.organization_id = o.id and me.status = 'atrasado')
    end as assinaturas_atrasadas,
    greatest(
      (select max(c.created_at) from public.checkins c where c.organization_id = o.id),
      (select max(t.created_at) from public.treinos t where t.organization_id = o.id)
    ) as ultima_atividade,
    o.cnpj_cpf,
    o.telefone,
    o.trial_vencimento,
    (
      select u.email::text
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.organization_id = o.id and m.role = 'gestor' and m.status = 'active'
      order by m.created_at asc
      limit 1
    ) as gestor_email
  from public.organizations o
  order by o.created_at desc;
end;
$$;

revoke execute on function public.get_superadmin_tenants() from public, anon;
grant execute on function public.get_superadmin_tenants() to authenticated;

-- O texto de 20261334010000: contagens da fila de cada academia.
create or replace function public.get_superadmin_fila_global()
 RETURNS TABLE(organization_id uuid, organizacao_nome text, status_org org_status, abertas bigint, vencidas bigint, criticas_abertas bigint, escaladas bigint, sem_responsavel bigint, concluidas_7d bigint, horas_pendencia_mais_antiga numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.acesso_arkefit('carteira') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
  end if;

  return query
  with abertas_cte as (
    select
      t.organization_id,
      count(*) as abertas,
      count(*) filter (where t.sla_prazo < now()) as vencidas,
      count(*) filter (where t.prioridade = 'critica') as criticas,
      count(*) filter (where t.escalada_em is not null) as escaladas,
      count(*) filter (where t.responsavel_id is null) as sem_responsavel,
      min(t.created_at) as mais_antiga
    from public.tarefas t
    where t.status in ('aberta', 'em_andamento', 'aguardando')
    group by t.organization_id
  ),
  concluidas_cte as (
    select t.organization_id, count(*) as concluidas_7d
    from public.tarefas t
    where t.status = 'concluida' and t.updated_at >= now() - interval '7 days'
    group by t.organization_id
  )
  select
    o.id,
    o.nome,
    o.status,
    coalesce(a.abertas, 0),
    coalesce(a.vencidas, 0),
    coalesce(a.criticas, 0),
    coalesce(a.escaladas, 0),
    coalesce(a.sem_responsavel, 0),
    coalesce(cc.concluidas_7d, 0),
    case when a.mais_antiga is not null
      then round(extract(epoch from (now() - a.mais_antiga)) / 3600, 1)
    end
  from public.organizations o
  left join abertas_cte a on a.organization_id = o.id
  left join concluidas_cte cc on cc.organization_id = o.id
  where not o.ficticia
  -- Mais pendência vencida no topo; entre empates, quem tem fila maior.
  order by coalesce(a.vencidas, 0) desc, coalesce(a.abertas, 0) desc, o.nome asc;
end;
$function$;

-- O texto de 20261362010000: os autônomos (sem dinheiro).
create or replace function public.get_superadmin_profissionais_autonomos()
returns table (
  organization_id uuid,
  nome text,
  slug text,
  especialidade public.app_role,
  status public.org_status,
  gestor_user_id uuid,
  gestor_nome text,
  email text,
  telefone text,
  ultimo_acesso timestamptz,
  alunos_total bigint,
  parceiros jsonb,
  created_at timestamptz,
  sem_gestor boolean,
  onboarding_completed boolean,
  etapa_implantacao text,
  pode_excluir boolean,
  gestor_pendente boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.acesso_arkefit('carteira') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.nome,
    o.slug,
    o.especialidade_profissional,
    o.status,
    g.user_id,
    p.full_name,
    u.email::text,
    p.phone,
    u.last_sign_in_at,
    (select count(*) from public.alunos a where a.organization_id = o.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nome', pp.full_name, 'email', uu.email, 'papel', m.role)
                       order by m.created_at)
        from public.organization_members m
        left join public.profiles pp on pp.user_id = m.user_id
        left join auth.users uu on uu.id = m.user_id
       where m.organization_id = o.id and m.status = 'active' and m.role in ('professor', 'nutricionista')
    ), '[]'::jsonb),
    o.created_at,
    g.user_id is null,
    o.onboarding_completed,
    i.etapa_atual,
    o.status = 'trial' or public.organizacao_nunca_usada(o.id),
    coalesce(g.status = 'pending', false)
  from public.organizations o
  left join lateral (
    select m.user_id, m.status from public.organization_members m
     where m.organization_id = o.id and m.role = 'gestor' and m.status in ('active', 'pending')
     order by m.status = 'active' desc, m.created_at
     limit 1
  ) g on true
  left join auth.users u on u.id = g.user_id
  left join public.profiles p on p.user_id = g.user_id
  left join public.implantacao i on i.organization_id = o.id
  where o.tipo = 'profissional_autonomo'
  order by o.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. O suporte: chamados, avaliações, assistente e implantação
-- ---------------------------------------------------------------------------
-- Os textos de 20261318010000, 20261392010000 e 20261315010000.
create or replace function public.get_superadmin_assistente_numeros(_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.acesso_arkefit('suporte') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'perguntas', (select count(*) from public.assistente_perguntas where created_at > now() - make_interval(days => _dias)),
    'resolveu', (select count(*) from public.assistente_perguntas where resolveu and created_at > now() - make_interval(days => _dias)),
    'nao_resolveu', (select count(*) from public.assistente_perguntas where resolveu = false and created_at > now() - make_interval(days => _dias)),
    'chamados', (select count(*) from public.chamados_suporte where created_at > now() - make_interval(days => _dias)),
    'abertos', (select count(*) from public.chamados_suporte where concluido_em is null),
    'atrasados', (select count(*) from public.chamados_suporte where concluido_em is null and prazo < now()),
    'academias', (select count(distinct organization_id) from public.assistente_perguntas where created_at > now() - make_interval(days => _dias))
  );
end;
$$;

create or replace function public.get_superadmin_chamados_suporte()
returns table (
  id uuid, organization_id uuid, organizacao text, tipo_organizacao text,
  quem text, email text, papel text,
  pergunta text, resposta_assistente text, artigos text[], contexto jsonb,
  prazo timestamptz, created_at timestamptz,
  responsavel text, acao text, desfecho text, proxima_checagem date, concluido_em timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.acesso_arkefit('suporte') then
    raise exception 'Acesso restrito à equipe da ArkeFit.' using errcode = '42501';
  end if;
  return query
  select c.id, c.organization_id, o.nome, o.tipo::text,
         p.full_name, u.email::text, c.papel,
         c.pergunta, c.resposta_assistente, c.artigos, c.contexto,
         c.prazo, c.created_at,
         pr.full_name, c.acao, c.desfecho, c.proxima_checagem, c.concluido_em
    from public.chamados_suporte c
    join public.organizations o on o.id = c.organization_id
    left join public.profiles p on p.user_id = c.user_id
    left join auth.users u on u.id = c.user_id
    left join public.profiles pr on pr.user_id = c.responsavel_id
   order by (c.concluido_em is null) desc, c.prazo, c.created_at desc
   limit 300;
end;
$$;

create or replace function public.concluir_chamado_suporte(_id uuid, _acao text, _desfecho text, _proxima_checagem date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.acesso_arkefit('suporte') then
    raise exception 'Só a ArkeFit encerra chamados de suporte.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(_desfecho, '')), '') is null then
    raise exception 'O chamado só se encerra com o desfecho registrado.' using errcode = '22023';
  end if;
  if _proxima_checagem is not null and _proxima_checagem < current_date then
    raise exception 'A próxima checagem não pode ficar no passado.' using errcode = '22023';
  end if;
  update public.chamados_suporte
     set acao = nullif(btrim(coalesce(_acao, '')), ''),
         desfecho = btrim(_desfecho),
         proxima_checagem = _proxima_checagem,
         responsavel_id = v_uid,
         concluido_em = now(),
         updated_at = now()
   where id = _id and concluido_em is null;
  if not found then
    raise exception 'Chamado não encontrado ou já encerrado.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.get_superadmin_avaliacoes_atendimento(_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(coalesce(_dias, 30), 1));
begin
  if not public.acesso_arkefit('suporte') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'avaliacoes', (select count(*) from public.avaliacoes_atendimento a where a.created_at > v_desde),
    'media', (select round(avg(a.nota)::numeric, 2) from public.avaliacoes_atendimento a where a.created_at > v_desde),
    -- Os chamados com uma pessoa do outro lado que se encerraram no período: a taxa de resposta.
    'encerrados', (select count(*) from public.chamados_suporte c
                    where c.concluido_em > v_desde and c.user_id is not null and c.responsavel_id is not null),
    'por_nota', (select coalesce(jsonb_object_agg(n::text, coalesce(q, 0)), '{}'::jsonb)
                   from generate_series(1, 5) n
                   left join (select a.nota, count(*) q from public.avaliacoes_atendimento a
                               where a.created_at > v_desde group by a.nota) t on t.nota = n),
    'recentes', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
                   from (select a.nota, a.comentario, a.created_at, o.nome as organizacao
                           from public.avaliacoes_atendimento a
                           join public.organizations o on o.id = a.organization_id
                          where a.created_at > v_desde
                          order by a.created_at desc
                          limit 10) r)
  );
end;
$$;

create or replace function public.get_superadmin_implantacoes()
returns table(
  organization_id uuid, nome text, tipo text, status text,
  iniciada_em timestamptz, etapa_atual text, etapa_atual_desde timestamptz, concluida_em timestamptz,
  etapas_feitas integer, etapas_total integer,
  asaas_conta_status text, evasao_meses integer,
  ultima_mensagem jsonb, chamado jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.acesso_arkefit('suporte') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query
  select o.id, o.nome, o.tipo::text, o.status::text,
         i.iniciada_em, i.etapa_atual, i.etapa_atual_desde, i.concluida_em,
         (select count(*)::integer from public.implantacao_etapas(o.id) e where e.principal and e.concluida),
         (select count(*)::integer from public.implantacao_etapas(o.id) e where e.principal),
         o.asaas_conta_status,
         (select count(*)::integer from public.academia_evasao_anterior ev where ev.organization_id = o.id),
         (select jsonb_build_object('tipo', m.tipo, 'etapa', m.etapa, 'enviado_em', m.enviado_em)
            from public.implantacao_mensagens m
           where m.organization_id = o.id and m.status = 'enviada'
           order by m.enviado_em desc limit 1),
         (select jsonb_build_object('id', c.id, 'etapa', c.etapa, 'motivo', c.motivo, 'aberto_em', c.aberto_em, 'prazo', c.prazo)
            from public.implantacao_chamados c
           where c.organization_id = o.id and c.concluido_em is null)
    from public.implantacao i
    join public.organizations o on o.id = i.organization_id
   where i.concluida_em is null or i.concluida_em > now() - interval '30 days'
   order by (select 1 from public.implantacao_chamados c where c.organization_id = o.id and c.concluido_em is null) nulls last,
            i.concluida_em nulls first, i.etapa_atual_desde nulls last;
end;
$$;

-- Também é da academia: a equipe dela vê a própria implantação, e o Admin
-- ARKE (gestor de toda academia) segue como antes.
create or replace function public.get_implantacao_organizacao(_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  i public.implantacao%rowtype;
  o public.organizations%rowtype;
  v_janela record;
begin
  if not (public.is_org_staff(v_uid, _organization_id)
          or public.acesso_arkefit('suporte') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;
  select * into o from public.organizations where id = _organization_id;
  if not found then
    return null;
  end if;
  select * into i from public.implantacao where organization_id = _organization_id;
  select * into v_janela from public.janela_evasao_anterior(_organization_id);

  return jsonb_build_object(
    'etapas', coalesce((select jsonb_agg(to_jsonb(e) order by e.ordem) from public.implantacao_etapas(_organization_id) e), '[]'::jsonb),
    'iniciada_em', coalesce(i.iniciada_em, o.created_at),
    'etapa_atual', i.etapa_atual,
    'etapa_atual_desde', i.etapa_atual_desde,
    'concluida_em', i.concluida_em,
    'slug', o.slug,
    'agente_ativo', coalesce((select valor = 1 from public.plataforma_config where chave = 'agente_implantacao_ativo'), false),
    'mensagens', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', m.tipo, 'etapa', m.etapa, 'motivo', m.motivo, 'enviado_em', m.enviado_em)
                       order by m.enviado_em desc)
        from (select * from public.implantacao_mensagens m
               where m.organization_id = _organization_id and m.status = 'enviada' and m.tipo <> 'chamado_arkefit'
               order by m.enviado_em desc limit 30) m
    ), '[]'::jsonb),
    'evasao_janela', jsonb_build_object('inicio', v_janela.inicio, 'fim', v_janela.fim),
    'evasao', coalesce((
      select jsonb_agg(jsonb_build_object('mes', e.mes, 'alunos_inicio', e.alunos_inicio, 'saidas', e.saidas) order by e.mes)
        from public.academia_evasao_anterior e where e.organization_id = _organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.concluir_chamado_implantacao(
  _chamado_id uuid, _acao text, _desfecho text, _proxima_checagem timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if not public.acesso_arkefit('suporte') then
    raise exception 'Só a ArkeFit encerra o chamado de implantação.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_acao, ''))) < 3 or length(btrim(coalesce(_desfecho, ''))) < 3 then
    raise exception 'Registre o que foi feito e o desfecho.' using errcode = '22023';
  end if;
  if _proxima_checagem is not null and _proxima_checagem <= now() then
    raise exception 'A próxima checagem precisa ser no futuro.' using errcode = '22023';
  end if;
  update public.implantacao_chamados
     set acao = btrim(_acao), desfecho = btrim(_desfecho), proxima_checagem = _proxima_checagem,
         responsavel_id = v_uid, concluido_em = now()
   where id = _chamado_id and concluido_em is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Chamado não encontrado ou já encerrado.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A operação: equipamentos, Vigia (leitura), rotinas e capacidade
-- ---------------------------------------------------------------------------
-- Os textos de 20261246010000, 20261272010000, 20261204010000 e
-- 20261242010000.
create or replace function public.get_superadmin_equipamentos()
returns table(
  catraca_id uuid, organization_id uuid, academia text, catraca text, status_catraca text,
  situacao text, versao text, modelo text, estado text, fila_offline integer, cache_alunos integer,
  ultima_sincronizacao timestamptz, ultimo_erro text, ultimo_erro_em timestamptz,
  equipamentos jsonb, ponte jsonb, capacidades text[], reportado_em timestamptz, ultimo_heartbeat_em timestamptz,
  comandos_pendentes integer, comandos_falhos_7d integer, acessos_hoje integer, contingencias_7d integer,
  checkins_parceiro_mes integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.acesso_arkefit('operacao') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query
  select c.id, c.organization_id, o.nome, c.nome, c.status,
         case when c.status <> 'ativo' then 'desativada'
              else public.situacao_gateway(c.ultimo_heartbeat_em, t.reportado_em, t.estado) end,
         t.versao, t.modelo, t.estado, t.fila_offline, t.cache_alunos,
         t.ultima_sincronizacao, t.ultimo_erro, t.ultimo_erro_em,
         coalesce(t.equipamentos, '[]'::jsonb), t.ponte, coalesce(t.capacidades, '{}'::text[]),
         t.reportado_em, c.ultimo_heartbeat_em,
         (select count(*)::int from public.gateway_comandos g
           where g.catraca_id = c.id and g.status in ('pendente', 'entregue')),
         (select count(*)::int from public.gateway_comandos g
           where g.catraca_id = c.id and g.status in ('falhou', 'expirado') and g.solicitado_em > now() - interval '7 days'),
         (select count(*)::int from public.acessos_catraca_logs l
           where l.catraca_id = c.id and l.created_at >= current_date),
         (select count(*)::int from public.gateway_eventos e
           where e.catraca_id = c.id and e.tipo = 'contingencia' and e.ocorrido_em > now() - interval '7 days'),
         (select count(*)::int from public.acessos_catraca_logs l
           where l.catraca_id = c.id and l.resultado = 'liberado_parceiro_externo'
             and l.created_at >= date_trunc('month', now()))
    from public.organizacao_catracas c
    join public.organizations o on o.id = c.organization_id
    left join public.gateway_telemetria t on t.catraca_id = c.id;
end;
$$;

create or replace function public.get_superadmin_acessos_catraca(
  _organization_id uuid default null,
  _catraca_id uuid default null,
  _resultado text default null,
  _desde timestamptz default null,
  _ate timestamptz default null,
  _limite integer default 200
)
returns table(
  id uuid, ocorrido_em timestamptz, academia text, catraca text, resultado text, giro text,
  validado_offline boolean, credencial text, aluno_ref text, parceiro_externo text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desde timestamptz := coalesce(_desde, now() - interval '24 hours');
  v_ate timestamptz := coalesce(_ate, now());
  v_limite integer := least(greatest(coalesce(_limite, 200), 1), 500);
  v_linhas integer;
begin
  if not public.acesso_arkefit('operacao') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  if v_ate - v_desde > interval '31 days' then
    raise exception 'Consulte no máximo 31 dias por vez.';
  end if;

  -- RETURN QUERY não encerra a função: devolve as linhas e segue, e é o
  -- que deixa registrar na auditoria quantas linhas a consulta devolveu.
  return query
    select l.id, l.created_at as ocorrido_em, o.nome as academia, c.nome as catraca, l.resultado, l.giro,
           l.validado_offline,
           case when l.resultado = 'liberado_parceiro_externo' then 'parceiro'
                when l.cpf_consultado = 'remoto' then 'remoto'
                when l.cpf_consultado like 'id:%' then 'identificador'
                when l.cpf_consultado is null or l.cpf_consultado = '' then 'nenhuma'
                else 'cpf' end as credencial,
           case when l.aluno_id is null then null
                else 'A-' || upper(substr(md5(l.aluno_id::text || l.organization_id::text), 1, 6)) end as aluno_ref,
           l.parceiro_externo
      from public.acessos_catraca_logs l
      join public.organizations o on o.id = l.organization_id
      left join public.organizacao_catracas c on c.id = l.catraca_id
     where l.created_at >= v_desde and l.created_at <= v_ate
       and (_organization_id is null or l.organization_id = _organization_id)
       and (_catraca_id is null or l.catraca_id = _catraca_id)
       and (_resultado is null or l.resultado = _resultado)
     order by l.created_at desc
     limit v_limite;
  get diagnostics v_linhas = row_count;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select auth.uid(), u.email, 'superadmin.consulta_acessos_catraca', 'acessos_catraca_logs', _catraca_id,
         -- Qualificado: `id` sozinho colidiria com a coluna de saída da função.
         coalesce((select o2.nome from public.organizations o2 where o2.id = _organization_id), 'todas as academias'),
         jsonb_build_object('desde', v_desde, 'ate', v_ate, 'resultado', _resultado,
                            'organization_id', _organization_id, 'linhas', v_linhas)
    from (select 1) x
    left join auth.users u on u.id = auth.uid();
end;
$$;

create or replace function public.get_superadmin_biometria()
returns table(
  organization_id uuid, academia text, consentimentos_vigentes integer, consentimentos_texto_antigo integer,
  alunos_com_identificador integer, revogacoes_30d integer, remocoes_em_andamento integer,
  remocoes_paradas integer, tarefas_equipamento_abertas integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.acesso_arkefit('operacao') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query
  select o.id, o.nome,
         (select count(*)::int from public.aluno_consentimento_biometrico b
           where b.organization_id = o.id and b.revogado_em is null
             and b.versao_texto = public.versao_consentimento_biometrico()),
         (select count(*)::int from public.aluno_consentimento_biometrico b
           where b.organization_id = o.id and b.revogado_em is null
             and b.versao_texto is distinct from public.versao_consentimento_biometrico()),
         (select count(*)::int from public.alunos a
           where a.organization_id = o.id and a.identificador_catraca is not null),
         (select count(*)::int from public.aluno_consentimento_biometrico b
           where b.organization_id = o.id and b.revogado_em > now() - interval '30 days'),
         (select count(distinct coalesce(g.lote, g.id))::int from public.gateway_comandos g
           where g.organization_id = o.id and g.tipo = 'apagar_usuario' and g.status in ('pendente', 'entregue')),
         -- Revogado há mais de 24 h e ainda sem a data de exclusão do equipamento.
         (select count(*)::int from public.aluno_consentimento_biometrico b
           where b.organization_id = o.id and b.revogado_em < now() - interval '24 hours'
             and b.excluido_do_equipamento_em is null
             and not exists (select 1 from public.aluno_consentimento_biometrico n
                              where n.aluno_id = b.aluno_id and n.revogado_em is null)),
         (select count(*)::int from public.tarefas t
           where t.organization_id = o.id and t.tipo = 'equipamento' and t.status not in ('concluida', 'cancelada'))
    from public.organizations o
   where exists (select 1 from public.organizacao_catracas c where c.organization_id = o.id)
      or exists (select 1 from public.aluno_consentimento_biometrico b where b.organization_id = o.id);
end;
$$;

-- O Vigia, só para ler: aprovar, dispensar, ligar e mudar o modo seguem do
-- Sócio (vigia_dispensar, definir_vigia_ativo, definir_modo_regra_vigia e a
-- função vigia-aprovar), e o Vigia não lê dado de aluno.
create or replace function public.get_superadmin_vigia(_horas integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.acesso_arkefit('operacao') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return public.vigia_resumo_interno(_horas);
end;
$$;

create or replace function public.get_superadmin_rotinas()
returns table (
  nome text,
  agendamento text,
  ativa boolean,
  situacao text,
  ultima_execucao timestamptz,
  ultimo_erro text,
  falhas_7d bigint,
  execucoes_7d bigint,
  intervalo_esperado interval
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Mesma régua das demais get_superadmin_*: a área é conferida aqui dentro.
  if not public.acesso_arkefit('operacao') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;

  return query select * from public.avaliar_rotinas();
end;
$$;

create or replace function public.get_superadmin_capacidade()
returns table(nome text, situacao text, usado_mb numeric, limite_mb numeric, percentual numeric, detalhe text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.acesso_arkefit('operacao') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query select * from public.avaliar_capacidade();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A atividade da academia continua do Sócio, agora com o código 42501
-- ---------------------------------------------------------------------------
-- O texto de 20261286010000. Ela traz o treino, a dieta, a avaliação física e
-- o desfecho das tarefas de cada aluno, com o nome: é saúde, e fica com o
-- Sócio.
create or replace function public.get_superadmin_organizacao_atividade(_organization_id uuid)
returns table(tipo text, data timestamp with time zone, descricao text, aluno_id uuid, aluno_nome text, responsavel_nome text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.' using errcode = '42501';
  end if;

  return query
  select 'treino'::text, t.created_at, t.titulo, t.aluno_id, pa.full_name, ps.full_name
  from public.treinos t
  left join public.alunos a on a.id = t.aluno_id
  left join public.profiles pa on pa.user_id = a.user_id
  left join public.profiles ps on ps.user_id = t.publicado_por
  where t.organization_id = _organization_id

  union all

  select 'dieta'::text, d.created_at, d.titulo, d.aluno_id, pa.full_name, ps.full_name
  from public.dietas d
  left join public.alunos a on a.id = d.aluno_id
  left join public.profiles pa on pa.user_id = a.user_id
  left join public.profiles ps on ps.user_id = d.publicado_por
  where d.organization_id = _organization_id

  union all

  select 'avaliacao'::text, av.data_avaliacao::timestamptz, 'Avaliação física'::text, av.aluno_id, pa.full_name, ps.full_name
  from public.avaliacoes_fisicas av
  left join public.alunos a on a.id = av.aluno_id
  left join public.profiles pa on pa.user_id = a.user_id
  left join public.profiles ps on ps.user_id = av.avaliado_por
  where av.organization_id = _organization_id

  union all

  select 'tarefa'::text, tf.updated_at, coalesce(tf.desfecho_acao, tf.motivo), tf.aluno_id, pa.full_name, ps.full_name
  from public.tarefas tf
  left join public.alunos a on a.id = tf.aluno_id
  left join public.profiles pa on pa.user_id = a.user_id
  left join public.profiles ps on ps.user_id = tf.responsavel_id
  where tf.organization_id = _organization_id and tf.status = 'concluida'

  order by 2 desc
  limit 20;
end;
$function$;
