-- Adoção da Metodologia ARKE por tenant.
--
-- Responde a pergunta que antecede o churn B2B: a academia está mesmo
-- usando o método, ou só pagando a assinatura? Uma unidade que paga em dia
-- mas não preenche anamnese, não prescreve e não faz check-in é a que
-- cancela no próximo ciclo — e isso não aparece em nenhum indicador
-- financeiro.
--
-- Cuidado central desta consulta: `base` parte de organizations e junta
-- alunos, anamnese, treinos, dietas e check-ins. Um aluno com 2 treinos
-- ativos vira 2 linhas (fan-out), então TODA contagem de alunos precisa de
-- DISTINCT. Sem isso o denominador infla e a cobertura sai dividida por um
-- número maior que o real.
create or replace function public.get_superadmin_adocao_metodologia()
returns table (
  organization_id uuid,
  nome text,
  status org_status,
  plano_b2b plano_b2b,
  alunos_total bigint,
  alunos_metodo_arke bigint,
  anamnese_concluida bigint,
  anamnese_pct numeric,
  com_treino_ativo bigint,
  treino_pct numeric,
  nutricao_contratada bigint,
  com_dieta_ativa bigint,
  nutricao_pct numeric,
  checkin_30d bigint,
  checkin_pct numeric,
  tarefas_concluidas_30d bigint,
  tarefas_com_desfecho_30d bigint,
  desfecho_pct numeric,
  tarefas_vencidas_abertas bigint,
  score_adocao numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  with base as (
    select
      o.id,
      o.nome,
      o.status,
      o.plano_b2b,
      -- DISTINCT obrigatório: ver comentário do cabeçalho. Aluno
      -- anonimizado (LGPD) também não entra — senão a cobertura
      -- despencaria sozinha com o tempo.
      count(distinct a.id) filter (where a.anonimizado_em is null) as alunos_total,
      count(distinct a.id) filter (
        where a.anonimizado_em is null and a.metodo_arke_status = 'ativo'
      ) as alunos_metodo_arke,
      -- Nutrição só conta para quem de fato contratou: uma academia que
      -- vende só o Essencial não tem plano alimentar por definição, e
      -- puni-la por isso seria alarme falso.
      count(distinct a.id) filter (
        where a.anonimizado_em is null and a.provedor_nutricao <> 'nenhum'
      ) as nutricao_contratada,
      count(distinct an.aluno_id) filter (where an.concluida_em is not null) as anamnese_concluida,
      count(distinct t.aluno_id) as com_treino_ativo,
      count(distinct d.aluno_id) as com_dieta_ativa,
      count(distinct c.aluno_id) as checkin_30d
    from public.organizations o
    left join public.alunos a on a.organization_id = o.id
    left join public.anamnese_acolhimento an
      on an.aluno_id = a.id and a.anonimizado_em is null
    left join public.treinos t
      on t.aluno_id = a.id and t.status = 'ativo' and a.anonimizado_em is null
    left join public.dietas d
      on d.aluno_id = a.id and d.status = 'ativo' and a.anonimizado_em is null
       and a.provedor_nutricao <> 'nenhum'
    left join public.checkins c
      on c.aluno_id = a.id and c.data >= current_date - 30 and a.anonimizado_em is null
    group by o.id, o.nome, o.status, o.plano_b2b
  ),
  fila as (
    select
      tf.organization_id,
      count(*) filter (
        where tf.status = 'concluida' and tf.updated_at >= now() - interval '30 days'
      ) as concluidas_30d,
      -- Regra do ciclo completo: uma pendência só está encerrada quando
      -- existe desfecho registrado. Concluir sem desfecho é justamente o
      -- desvio de método que interessa enxergar.
      count(*) filter (
        where tf.status = 'concluida' and tf.updated_at >= now() - interval '30 days'
          and tf.desfecho_acao is not null and btrim(tf.desfecho_acao) <> ''
      ) as com_desfecho_30d,
      count(*) filter (
        where tf.status in ('aberta', 'em_andamento', 'aguardando') and tf.sla_prazo < now()
      ) as vencidas_abertas
    from public.tarefas tf
    group by tf.organization_id
  ),
  pct as (
    select
      b.*,
      coalesce(f.concluidas_30d, 0) as concluidas_30d,
      coalesce(f.com_desfecho_30d, 0) as com_desfecho_30d,
      coalesce(f.vencidas_abertas, 0) as vencidas_abertas,
      case when b.alunos_total > 0
        then round(b.anamnese_concluida::numeric / b.alunos_total * 100, 1) end as p_anamnese,
      case when b.alunos_total > 0
        then round(b.com_treino_ativo::numeric / b.alunos_total * 100, 1) end as p_treino,
      case when b.nutricao_contratada > 0
        then round(b.com_dieta_ativa::numeric / b.nutricao_contratada * 100, 1) end as p_nutricao,
      case when b.alunos_total > 0
        then round(b.checkin_30d::numeric / b.alunos_total * 100, 1) end as p_checkin
    from base b
    left join fila f on f.organization_id = b.id
  ),
  final as (
    select
      p.*,
      case when p.concluidas_30d > 0
        then round(p.com_desfecho_30d::numeric / p.concluidas_30d * 100, 1) end as p_desfecho,
      -- Média só dos pilares aplicáveis: um nulo (ex.: nutrição não
      -- contratada) é ignorado em vez de entrar como zero e derrubar o
      -- score de quem não vende aquele serviço. Sem alunos, o score é
      -- nulo — "ainda não começou" não é a mesma coisa que "não usa".
      case when p.alunos_total > 0 then round((
        (coalesce(p.p_anamnese, 0) + coalesce(p.p_treino, 0)
          + coalesce(p.p_checkin, 0) + coalesce(p.p_nutricao, 0))
        / nullif(
            (case when p.p_anamnese is not null then 1 else 0 end)
          + (case when p.p_treino is not null then 1 else 0 end)
          + (case when p.p_checkin is not null then 1 else 0 end)
          + (case when p.p_nutricao is not null then 1 else 0 end), 0)
      ), 1) end as score
    from pct p
  )
  select
    fn.id, fn.nome, fn.status, fn.plano_b2b,
    fn.alunos_total, fn.alunos_metodo_arke,
    fn.anamnese_concluida, fn.p_anamnese,
    fn.com_treino_ativo, fn.p_treino,
    fn.nutricao_contratada, fn.com_dieta_ativa, fn.p_nutricao,
    fn.checkin_30d, fn.p_checkin,
    fn.concluidas_30d, fn.com_desfecho_30d, fn.p_desfecho,
    fn.vencidas_abertas,
    fn.score
  from final fn
  -- Quem tem aluno vem primeiro, e dentro disso o pior score no topo: a
  -- lista existe para achar risco, não para premiar quem vai bem.
  -- Ordenar por nome da coluna, nunca por ordinal: a posição muda junto
  -- com a lista de colunas e o erro passa despercebido.
  order by
    case when fn.alunos_total > 0 then 0 else 1 end,
    fn.score asc nulls last,
    fn.nome asc;
end;
$$;
