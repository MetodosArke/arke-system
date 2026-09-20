-- Auditoria de integração — achados #2/#3/#7: funil de conversão,
-- ocupação de turmas (studios) e frequência real via catraca ainda não
-- tinham nenhuma leitura em Gestão 360°. Três RPCs staff-only (mesmo
-- padrão de obter_engajamento_alunos_organizacao: infere a organização
-- via organization_members do chamador).

-- 1. Funil de conversão — quantos alunos matriculados avançam pra adesão
-- ao Método ARKE, completam a anamnese e saem do estágio inicial da
-- jornada. Métrica de topo de funil pro cross-sell do wholesale.
create or replace function public.obter_funil_conversao_organizacao()
returns table (
  alunos_matriculados      bigint,
  alunos_aderiram_metodo   bigint,
  alunos_anamnese_completa bigint,
  alunos_pos_mapa          bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _org_id uuid;
begin
  select organization_id into _org_id
  from public.organization_members
  where user_id = auth.uid() and status = 'active'
  limit 1;

  if _org_id is null then
    raise exception 'Sem organização vinculada.';
  end if;

  return query
  select
    (select count(*) from public.alunos a where a.organization_id = _org_id),
    (select count(*) from public.alunos a where a.organization_id = _org_id and a.metodo_arke_status = 'ativo'),
    (select count(*) from public.alunos a
       join public.anamnese_acolhimento an on an.aluno_id = a.id
       where a.organization_id = _org_id and an.concluida_em is not null),
    (select count(*) from public.alunos a where a.organization_id = _org_id and a.fase_jornada <> 'mapa');
end;
$$;

revoke execute on function public.obter_funil_conversao_organizacao() from public;
grant execute on function public.obter_funil_conversao_organizacao() to authenticated;

-- 2. Ocupação de turmas — só faz sentido pra quem usa o módulo de
-- Studio; vagas_ofertadas soma a capacidade de cada sessão (turma+data)
-- que de fato teve algum agendamento no mês, então a taxa reflete
-- ocupação das sessões que rodaram, não capacidade teórica do mês
-- inteiro (turma sem nenhum agendamento não distorce a taxa pra baixo).
create or replace function public.obter_ocupacao_turmas_organizacao()
returns table (
  turmas_ativas       integer,
  vagas_ofertadas_mes integer,
  agendamentos_mes    integer,
  taxa_ocupacao_pct   numeric,
  lista_espera_mes    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _org_id uuid;
  _inicio date := date_trunc('month', current_date)::date;
  _fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  _vagas_ofertadas integer;
  _agendamentos integer;
begin
  select organization_id into _org_id
  from public.organization_members
  where user_id = auth.uid() and status = 'active'
  limit 1;

  if _org_id is null then
    raise exception 'Sem organização vinculada.';
  end if;

  select coalesce(sum(t.capacidade_maxima), 0) into _vagas_ofertadas
  from (
    select distinct a.turma_id, a.data
    from public.agendamentos a
    where a.organization_id = _org_id and a.data between _inicio and _fim
  ) sessoes
  join public.turmas t on t.id = sessoes.turma_id;

  select count(*) into _agendamentos
  from public.agendamentos a
  where a.organization_id = _org_id and a.data between _inicio and _fim and a.status in ('agendado', 'presente');

  return query
  select
    (select count(*)::integer from public.turmas where organization_id = _org_id and ativa),
    _vagas_ofertadas,
    _agendamentos,
    case when _vagas_ofertadas > 0 then round(_agendamentos::numeric / _vagas_ofertadas * 100, 1) else 0 end,
    (select count(*)::integer from public.agendamentos a
       where a.organization_id = _org_id and a.data between _inicio and _fim and a.status = 'lista_espera');
end;
$$;

revoke execute on function public.obter_ocupacao_turmas_organizacao() from public;
grant execute on function public.obter_ocupacao_turmas_organizacao() to authenticated;

-- 3. Frequência real via catraca — cruza acessos liberados com
-- dia_e_esperado_treino (mesma fonte de verdade da Etapa L), só pra
-- quem tem catraca ativa. Mais confiável que auto-registro de treino
-- (aluno pode estar presente fisicamente e nunca marcar o treino no app).
create or replace function public.obter_frequencia_catraca_organizacao()
returns table (
  tem_catraca_ativa         boolean,
  frequencia_catraca_pct_7d numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _org_id uuid;
  _tem_catraca boolean;
begin
  select organization_id into _org_id
  from public.organization_members
  where user_id = auth.uid() and status = 'active'
  limit 1;

  if _org_id is null then
    raise exception 'Sem organização vinculada.';
  end if;

  select exists(
    select 1 from public.organizacao_catracas where organization_id = _org_id and status = 'ativo'
  ) into _tem_catraca;

  if not _tem_catraca then
    return query select false, null::numeric;
    return;
  end if;

  return query
  with frequencia_por_aluno as (
    select
      t.aluno_id,
      (
        select count(*) from generate_series(current_date - 6, current_date, interval '1 day') d(dia)
        where public.dia_e_esperado_treino(t.aluno_id, extract(isodow from d.dia)::int, a.dias_descanso)
          and exists (
            select 1 from public.acessos_catraca_logs l
            where l.aluno_id = t.aluno_id and l.resultado = 'liberado'
              and l.created_at::date = d.dia::date
          )
      )::numeric
      /
      nullif((
        select count(*) from generate_series(current_date - 6, current_date, interval '1 day') d(dia)
        where public.dia_e_esperado_treino(t.aluno_id, extract(isodow from d.dia)::int, a.dias_descanso)
      ), 0) * 100 as pct
    from public.treinos t
    join public.alunos a on a.id = t.aluno_id
    where t.status = 'ativo' and t.organization_id = _org_id
  )
  select true, coalesce(round(avg(pct), 1), 0) from frequencia_por_aluno;
end;
$$;

revoke execute on function public.obter_frequencia_catraca_organizacao() from public;
grant execute on function public.obter_frequencia_catraca_organizacao() to authenticated;
