-- Fase 6 do Ecossistema: operação da célula e prova de valor (23/09/2026).
--
-- Duas perguntas que o produto ainda não sabia responder, e que decidem se o
-- BPO se sustenta:
--
-- 1. **A ArkeFit está cumprindo o que prometeu?** O SLA do Mentor é a promessa
--    central do modelo, e até aqui ninguém media se ela era cumprida.
-- 2. **A academia está vendo o serviço acontecer?** A fila do Mentor é
--    invisível para ela de propósito (Fase 4). Serviço que o cliente não vê,
--    o cliente cancela — e cancela achando que não estava recebendo nada.

-- ── 1. Horas úteis: a promessa só significa algo nas horas em que se trabalha ──
--
-- O SLA nascia em horas de relógio: `now() + interval '4 hours'`. Tarefa
-- aberta às 19h de sexta vencia às 23h de sexta, com a célula fechada — o
-- painel acusaria atraso de uma equipe que não tinha como agir, e a mesma
-- conta perdoaria a tarefa aberta segunda às 9h. Medida errada nos dois
-- sentidos, o que é pior do que não medir.
--
-- O expediente da célula: segunda a sexta 08–20, sábado 08–12, domingo
-- fechado. Fuso de Brasília, que desde `20261221010000_fuso_brasilia.sql` é o
-- fuso do banco — esta função depende disso e por isso é `stable`, não
-- `immutable`.

create or replace function public.prazo_util(_inicio timestamptz, _horas numeric)
returns timestamptz
language plpgsql
stable
set search_path to 'public'
as $$
declare
  _restante interval;
  _cursor   timestamptz := _inicio;
  _dia      date;
  _dow      int;
  _abre     timestamptz;
  _fecha    timestamptz;
  _voltas   int := 0;
begin
  if _inicio is null or _horas is null or _horas <= 0 then
    return _inicio;
  end if;

  _restante := make_interval(mins => round(_horas * 60)::int);

  loop
    _voltas := _voltas + 1;
    -- Trava: 120 dias de expediente cobrem qualquer SLA que faça sentido, e um
    -- laço infinito aqui travaria a **inserção da tarefa**, não só o cálculo.
    if _voltas > 120 then
      return _cursor;
    end if;

    _dia := _cursor::date;
    _dow := extract(dow from _dia);

    if _dow = 0 then
      _cursor := (_dia + 1)::timestamptz;
      continue;
    end if;

    _abre  := (_dia + time '08:00')::timestamptz;
    _fecha := (_dia + (case when _dow = 6 then time '12:00' else time '20:00' end))::timestamptz;

    if _cursor < _abre then
      _cursor := _abre;
    end if;

    if _cursor >= _fecha then
      _cursor := (_dia + 1)::timestamptz;
      continue;
    end if;

    if _restante <= (_fecha - _cursor) then
      return _cursor + _restante;
    end if;

    _restante := _restante - (_fecha - _cursor);
    _cursor := (_dia + 1)::timestamptz;
  end loop;
end;
$$;

comment on function public.prazo_util(timestamptz, numeric) is
  'Prazo somando apenas horas de expediente da celula (seg-sex 08-20, sab 08-12, Brasilia). Horas de relogio puniriam a equipe pelo fim de semana.';

-- O espelho: quanto de expediente houve entre dois instantes. É com isto que
-- se mede o tempo de resposta real, e não com `ate - de`, que contaria a noite
-- e o domingo como se fossem atraso.
create or replace function public.horas_uteis_entre(_de timestamptz, _ate timestamptz)
returns numeric
language plpgsql
stable
set search_path to 'public'
as $$
declare
  _total  interval := interval '0';
  _cursor timestamptz := _de;
  _dia    date;
  _dow    int;
  _abre   timestamptz;
  _fecha  timestamptz;
  _voltas int := 0;
begin
  if _de is null or _ate is null or _ate <= _de then
    return 0;
  end if;

  loop
    _voltas := _voltas + 1;
    if _voltas > 400 then
      exit;
    end if;

    _dia := _cursor::date;
    _dow := extract(dow from _dia);

    if _dow > 0 then
      _abre  := (_dia + time '08:00')::timestamptz;
      _fecha := (_dia + (case when _dow = 6 then time '12:00' else time '20:00' end))::timestamptz;

      if _cursor < _abre then
        _cursor := _abre;
      end if;
      if _cursor >= _ate then
        exit;
      end if;
      if _cursor < _fecha then
        _total := _total + (least(_fecha, _ate) - _cursor);
      end if;
    end if;

    _cursor := (_dia + 1)::timestamptz;
    if _cursor >= _ate then
      exit;
    end if;
  end loop;

  return round((extract(epoch from _total) / 3600)::numeric, 2);
end;
$$;

comment on function public.horas_uteis_entre(timestamptz, timestamptz) is
  'Horas de expediente entre dois instantes. Medir o tempo de resposta em horas de relogio contaria a madrugada como atraso.';

-- ── 2. O SLA da ArkeFit, num lugar só ──────────────────────────────────────
--
-- A promessa é da ArkeFit, então o número é dela e mora aqui — não espalhado
-- pelos treze geradores de tarefa, onde cada um viraria uma promessa
-- diferente e ninguém saberia qual é a oficial.
create or replace function public.sla_mentor_horas(_prioridade public.tarefa_prioridade)
returns numeric
language sql
immutable
as $$
  select case _prioridade
           when 'critica' then 2
           when 'alta'    then 4
           when 'media'   then 8
           else                24
         end::numeric;
$$;

comment on function public.sla_mentor_horas(public.tarefa_prioridade) is
  'Horas UTEIS de SLA da celula de Mentor da ArkeFit, por prioridade. Um lugar so: treze geradores dariam treze promessas.';

/**
 * Reescreve o prazo das tarefas da ArkeFit em horas úteis.
 *
 * Um gatilho, e não uma correção nos treze geradores, pela mesma razão do
 * fuso: o defeito não está em nenhum deles, está na premissa de que hora de
 * relógio é hora de trabalho. Assim a tarefa que alguém escrever depois já
 * nasce com o prazo certo, em vez de nascer errada de novo.
 *
 * **A ordem dos gatilhos é carga estrutural aqui.** No Postgres eles disparam
 * em ordem alfabética, e este precisa ser o último dos `before insert` de
 * `tarefas`: `trg_definir_dono_da_tarefa` decide o dono e
 * `trg_tarefas_bump_prioridade_elite` ajusta a prioridade — os dois valores de
 * que este cálculo depende. Daí o nome começar por `trg_ultimo_`, que ordena
 * depois de `trg_definir_` e de `trg_tarefas_`. Renomear qualquer um dos três
 * quebra isto em silêncio.
 *
 * O prazo da academia fica como está: o expediente dela não é o nosso, e
 * inventar um horário comercial para ela seria medir contra uma promessa que
 * ninguém fez.
 */
create or replace function public.aplicar_sla_util_mentor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.dono = 'arkefit' then
    new.sla_prazo := public.prazo_util(
      coalesce(new.created_at, now()),
      public.sla_mentor_horas(new.prioridade)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ultimo_sla_util_mentor on public.tarefas;
create trigger trg_ultimo_sla_util_mentor
  before insert on public.tarefas
  for each row execute function public.aplicar_sla_util_mentor();

revoke execute on function public.aplicar_sla_util_mentor() from public;

-- ── 3. Quando a tarefa foi resolvida ───────────────────────────────────────
--
-- Sem esta coluna, o tempo de resposta teria de sair de `updated_at` — que é
-- o instante da **última edição**, não o da resolução. Bastaria alguém
-- corrigir um desfecho uma semana depois para a tarefa aparecer como resolvida
-- em uma semana. Métrica que se estraga sozinha ao se mexer no dado é pior que
-- métrica nenhuma, porque ninguém desconfia dela.
alter table public.tarefas
  add column if not exists concluida_em timestamptz;

comment on column public.tarefas.concluida_em is
  'Instante da conclusao, carimbado pelo gatilho. Nao usar updated_at para isto: ele muda a cada edicao posterior.';

create or replace function public.carimbar_conclusao_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'concluida' and old.status is distinct from 'concluida' then
    new.concluida_em := now();
  elsif new.status <> 'concluida' then
    -- Tarefa reaberta deixa de ter conclusão: manter o carimbo antigo faria a
    -- mesma tarefa contar duas vezes como resolvida.
    new.concluida_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_carimbar_conclusao_tarefa on public.tarefas;
create trigger trg_carimbar_conclusao_tarefa
  before update on public.tarefas
  for each row execute function public.carimbar_conclusao_tarefa();

revoke execute on function public.carimbar_conclusao_tarefa() from public;

create index if not exists idx_tarefas_concluidas_mentor
  on public.tarefas (dono, concluida_em)
  where concluida_em is not null;

-- Linhas antigas recebem `updated_at` como aproximação — com a ressalva de que
-- é aproximação. No console do Mentor a conclusão é uma escrita só (ação,
-- desfecho e status juntos), então para elas os dois instantes coincidem.
update public.tarefas
   set concluida_em = updated_at
 where status = 'concluida' and concluida_em is null;

-- ── 4. A ArkeFit se mede ───────────────────────────────────────────────────
create or replace function public.get_operacao_mentor(_dias integer default 30)
returns table(
  abertas bigint,
  vencidas bigint,
  concluidas bigint,
  dentro_do_sla bigint,
  fora_do_sla bigint,
  pct_sla numeric,
  horas_ate_resposta_mediana numeric,
  horas_ate_resposta_media numeric,
  alunos_sob_acompanhamento bigint,
  organizacoes_atendidas bigint,
  mentores_ativos bigint,
  alunos_por_mentor numeric,
  tarefas_por_aluno_mes numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _desde timestamptz := now() - make_interval(days => greatest(_dias, 1));
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Apenas a equipe da ArkeFit acessa a operacao do Mentor.' using errcode = '42501';
  end if;

  return query
  with concluidas_periodo as (
    select t.responsavel_id,
           (t.concluida_em <= t.sla_prazo) as no_prazo,
           public.horas_uteis_entre(t.created_at, t.concluida_em) as horas
      from public.tarefas t
     where t.dono = 'arkefit'
       and t.concluida_em is not null
       and t.concluida_em >= _desde
  ),
  -- **O denominador da capacidade é o aluno do Método, não o aluno com tarefa
  -- aberta.** Quem está sob acompanhamento e não deu trabalho neste mês
  -- continua sendo carga da célula: é dele que virá a próxima tarefa.
  base as (
    select count(*) as alunos,
           count(distinct a.organization_id) as orgs
      from public.alunos a
     where a.metodo_arke_status = 'ativo'
  ),
  mentores as (
    select count(distinct responsavel_id) as n
      from concluidas_periodo where responsavel_id is not null
  )
  select
    (select count(*) from public.tarefas t
      where t.dono = 'arkefit' and t.status in ('aberta', 'em_andamento', 'aguardando')),
    (select count(*) from public.tarefas t
      where t.dono = 'arkefit' and t.status in ('aberta', 'em_andamento', 'aguardando')
        and t.sla_prazo < now()),
    (select count(*) from concluidas_periodo),
    (select count(*) filter (where no_prazo) from concluidas_periodo),
    (select count(*) filter (where not no_prazo) from concluidas_periodo),
    (select case when count(*) = 0 then null
                 else round(100.0 * count(*) filter (where no_prazo) / count(*), 1) end
       from concluidas_periodo),
    (select round(percentile_cont(0.5) within group (order by horas)::numeric, 2) from concluidas_periodo),
    (select round(avg(horas)::numeric, 2) from concluidas_periodo),
    (select alunos from base),
    (select orgs from base),
    (select n from mentores),
    (select case when (select n from mentores) = 0 then null
                 else round((select alunos from base)::numeric / (select n from mentores), 1) end),
    -- Normalizado para 30 dias: é a taxa que projeta quanto um aluno a mais
    -- custa de fila por mês, e é dela que sai o tamanho da célula.
    (select case when (select alunos from base) = 0 then null
                 else round((select count(*) from concluidas_periodo)::numeric
                            * 30 / greatest(_dias, 1)
                            / (select alunos from base), 2) end);
end;
$$;

comment on function public.get_operacao_mentor(integer) is
  'SLA, carga e capacidade da celula de Mentor. Horas ate resposta sao LATENCIA, nao esforco: tarefa resolvida em 3h pode ter levado 10 minutos de trabalho.';

revoke execute on function public.get_operacao_mentor(integer) from public;
grant execute on function public.get_operacao_mentor(integer) to authenticated;

-- Carga por mentor. Sem isto não há como saber se a fila está distribuída ou
-- se uma pessoa está segurando tudo — que é o modo como uma célula de BPO
-- quebra antes de alguém perceber.
create or replace function public.get_carga_mentores(_dias integer default 30)
returns table(
  mentor_id uuid,
  mentor_nome text,
  abertas bigint,
  concluidas bigint,
  dentro_do_sla bigint,
  pct_sla numeric,
  horas_ate_resposta_mediana numeric,
  por_semana numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _desde timestamptz := now() - make_interval(days => greatest(_dias, 1));
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Apenas a equipe da ArkeFit acessa a operacao do Mentor.' using errcode = '42501';
  end if;

  return query
  with base as (
    select t.responsavel_id as rid,
           coalesce(p.full_name, 'Mentor') as nome,
           (t.status in ('aberta', 'em_andamento', 'aguardando')) as aberta,
           (t.concluida_em is not null and t.concluida_em >= _desde) as fechada,
           (t.concluida_em is not null and t.concluida_em >= _desde
            and t.concluida_em <= t.sla_prazo) as no_prazo,
           case when t.concluida_em is not null and t.concluida_em >= _desde
                then public.horas_uteis_entre(t.created_at, t.concluida_em) end as horas
      from public.tarefas t
      left join public.profiles p on p.user_id = t.responsavel_id
     where t.dono = 'arkefit'
       and t.responsavel_id is not null
  )
  select b.rid,
         b.nome,
         count(*) filter (where b.aberta),
         count(*) filter (where b.fechada),
         count(*) filter (where b.no_prazo),
         case when count(*) filter (where b.fechada) = 0 then null
              else round(100.0 * count(*) filter (where b.no_prazo)
                         / count(*) filter (where b.fechada), 1) end,
         round(percentile_cont(0.5) within group (order by b.horas)::numeric, 2),
         round(count(*) filter (where b.fechada)::numeric * 7 / greatest(_dias, 1), 1)
    from base b
   group by b.rid, b.nome
   order by 4 desc, 3 desc;
end;
$$;

comment on function public.get_carga_mentores(integer) is
  'Carga e SLA por mentor. Fila concentrada numa pessoa e como uma celula de BPO quebra sem ninguem perceber antes.';

revoke execute on function public.get_carga_mentores(integer) from public;
grant execute on function public.get_carga_mentores(integer) to authenticated;

-- ── 5. A academia vê o serviço ─────────────────────────────────────────────
--
-- A fila do Mentor não é legível pela academia: a regra de leitura de
-- `tarefas` exige `dono = 'academia'`, e o canal `mensagens_mentor` não tem
-- `is_org_staff` — de propósito, nas Fases 4 e 2.
--
-- Isto **força** o desenho certo em vez de deixá-lo opcional: o que a academia
-- vê não é a fila, é o **resultado**. Contagens, desfechos registrados e o que
-- foi pedido a ela. O conteúdo da conversa entre aluno e mentor continua
-- fora — é ele que permite ao aluno falar do que não contaria ao professor.
create or replace function public.get_valor_mentor_organizacao(_organization_id uuid, _dias integer default 30)
returns table(
  alunos_no_metodo bigint,
  atendimentos_concluidos bigint,
  alunos_alcancados bigint,
  instrucoes_enviadas bigint,
  instrucoes_concluidas bigint,
  avancos_de_fase bigint,
  mensagens_trocadas bigint,
  pct_sla numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _desde timestamptz := now() - make_interval(days => greatest(_dias, 1));
begin
  if not (public.is_org_staff(auth.uid(), _organization_id)
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Sem acesso a esta organizacao.' using errcode = '42501';
  end if;

  return query
  with atend as (
    select t.aluno_id as aid, t.concluida_em as fim, t.sla_prazo as prazo
      from public.tarefas t
     where t.organization_id = _organization_id
       and t.dono = 'arkefit'
       and t.concluida_em is not null
       and t.concluida_em >= _desde
  )
  select
    (select count(*) from public.alunos a
      where a.organization_id = _organization_id and a.metodo_arke_status = 'ativo'),
    (select count(*) from atend),
    (select count(distinct aid) from atend),
    (select count(*) from public.tarefas t
      where t.organization_id = _organization_id
        and t.tipo = 'instrucao_presencial' and t.created_at >= _desde),
    (select count(*) from public.tarefas t
      where t.organization_id = _organization_id
        and t.tipo = 'instrucao_presencial'
        and t.concluida_em is not null and t.concluida_em >= _desde),
    (select count(*) from public.aluno_fase_historico h
      join public.alunos a on a.id = h.aluno_id
     where a.organization_id = _organization_id and h.created_at >= _desde),
    (select count(*) from public.mensagens_mentor m
      where m.organization_id = _organization_id and m.created_at >= _desde),
    (select case when count(*) = 0 then null
                 else round(100.0 * count(*) filter (where fim <= prazo) / count(*), 1) end
       from atend);
end;
$$;

comment on function public.get_valor_mentor_organizacao(uuid, integer) is
  'O que o Mentor da ArkeFit fez pelos alunos desta academia. Resultado, nunca a fila: o conteudo do canal aluno-mentor fica de fora.';

revoke execute on function public.get_valor_mentor_organizacao(uuid, integer) from public;
grant execute on function public.get_valor_mentor_organizacao(uuid, integer) to authenticated;

-- A contagem sozinha não é prova de serviço — "42 atendimentos" é um número
-- que qualquer um escreve. O desfecho registrado é a prova, e é o mesmo texto
-- que o mentor teve de escrever para poder fechar a tarefa.
create or replace function public.get_atendimentos_mentor_organizacao(
  _organization_id uuid,
  _dias integer default 30,
  _limite integer default 50
)
returns table(
  aluno_id uuid,
  aluno_nome text,
  tipo public.tarefa_tipo,
  motivo text,
  desfecho text,
  concluida_em timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_org_staff(auth.uid(), _organization_id)
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Sem acesso a esta organizacao.' using errcode = '42501';
  end if;

  return query
  select t.aluno_id,
         coalesce(p.full_name, 'Aluno'),
         t.tipo,
         t.motivo,
         t.desfecho_acao,
         t.concluida_em
    from public.tarefas t
    join public.alunos a on a.id = t.aluno_id
    left join public.profiles p on p.user_id = a.user_id
   where t.organization_id = _organization_id
     and t.dono = 'arkefit'
     and t.concluida_em is not null
     and t.concluida_em >= now() - make_interval(days => greatest(_dias, 1))
   order by t.concluida_em desc
   limit greatest(least(_limite, 200), 1);
end;
$$;

comment on function public.get_atendimentos_mentor_organizacao(uuid, integer, integer) is
  'Desfechos dos atendimentos do Mentor, para a academia. "42 atendimentos" qualquer um escreve; o desfecho registrado e a prova.';

revoke execute on function public.get_atendimentos_mentor_organizacao(uuid, integer, integer) from public;
grant execute on function public.get_atendimentos_mentor_organizacao(uuid, integer, integer) to authenticated;

revoke execute on function public.prazo_util(timestamptz, numeric) from public;
revoke execute on function public.horas_uteis_entre(timestamptz, timestamptz) from public;
revoke execute on function public.sla_mentor_horas(public.tarefa_prioridade) from public;
grant execute on function public.prazo_util(timestamptz, numeric) to authenticated, service_role;
grant execute on function public.horas_uteis_entre(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.sla_mentor_horas(public.tarefa_prioridade) to authenticated, service_role;
