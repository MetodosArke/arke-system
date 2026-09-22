-- Rodada 3 dos ajustes do app original: plano Free no lugar do Essencial.
--
-- Decisões de 22/09/2026:
--   D1  a academia marca a situação do aluno (em dia, inadimplente, pausado)
--       na ficha e na importação; quando ela cobrar pelo ARKE, vira automático.
--   D2  Free = treinos, calendário, rotina, diário de água e dieta, chat com os
--       professores da academia. Método = M.A.P.A.®, fases, nutricionista,
--       acolhimento Elite. No chat, Elite fura a fila e Integrado vem antes do Free.
--   D3  a nutricionista do Free é a da academia (papel que já existe).
--   D4  o Essencial sai da tabela de atacado; a academia paga só o plano B2B.
--   D7  grupos musculares: a lista do app original.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Situação do aluno na academia (D1)
-- ─────────────────────────────────────────────────────────────────────────
create type public.situacao_aluno_academia as enum ('em_dia', 'inadimplente', 'pausado');

alter table public.alunos
  add column situacao_academia public.situacao_aluno_academia not null default 'em_dia',
  add column situacao_academia_em timestamptz,
  add column situacao_academia_por uuid references auth.users(id) on delete set null;

comment on column public.alunos.situacao_academia is
  'Situação do aluno com a academia, marcada pela equipe (gestor ou recepção). Só "em_dia" entra no app; é o que libera o plano Free.';

-- Quem mexe na situação é gestor, recepção ou a ArkeFit. A política de UPDATE
-- de alunos vale para toda a equipe (o professor edita dias de descanso,
-- metas...), então a trava é por coluna, aqui. Contexto sem usuário
-- (service_role: importação, matrícula) passa — as funções já conferem o papel.
create or replace function public.proteger_situacao_aluno()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.situacao_academia is not distinct from old.situacao_academia then
    return new;
  end if;
  if v_uid is not null
     and not (public.has_org_role(v_uid, new.organization_id, 'gestor')
              or public.has_org_role(v_uid, new.organization_id, 'recepcao')
              or public.has_role(v_uid, 'admin_arke')
              or public.has_role(v_uid, 'superadmin')) then
    raise exception 'Só o gestor ou a recepção alteram a situação do aluno.' using errcode = '42501';
  end if;
  new.situacao_academia_em := now();
  new.situacao_academia_por := v_uid;
  return new;
end;
$$;

create trigger trg_proteger_situacao_aluno
  before update on public.alunos
  for each row execute function public.proteger_situacao_aluno();

-- "Pausas e cancelamentos encerram automações ativas imediatamente": aluno
-- pausado ou inadimplente não está no app, e uma tarefa de barreira ou de
-- ativação para ele só ocupa a fila. Encerra só as automáticas (origem_evento
-- preenchida) e registra o desfecho, que a fila exige.
create or replace function public.encerrar_automacoes_situacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.situacao_academia <> 'em_dia' and old.situacao_academia = 'em_dia' then
    update public.tarefas
       set status = 'cancelada',
           desfecho_acao = 'Encerrada automaticamente: aluno marcado como '
                           || case new.situacao_academia when 'pausado' then 'pausado' else 'inadimplente' end
                           || ' na academia.'
     where aluno_id = new.id
       and status in ('aberta', 'em_andamento', 'aguardando')
       and origem_evento is not null
       and tipo in ('ativacao', 'barreira', 'engajamento_baixo', 'acolhimento_elite');
  end if;
  return null;
end;
$$;

create trigger trg_encerrar_automacoes_situacao
  after update of situacao_academia on public.alunos
  for each row execute function public.encerrar_automacoes_situacao();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Essencial sai da tabela (D4)
-- ─────────────────────────────────────────────────────────────────────────
alter table public.planos_atacado add column disponivel boolean not null default true;
update public.planos_atacado set disponivel = false where id = 'essencial';

comment on column public.planos_atacado.disponivel is
  'Nível oferecido hoje. O Essencial foi substituído pelo plano Free em 22/09/2026; o valor do enum fica porque há histórico apontando para ele.';

-- A conta de homologação E2E era Método Essencial sem assinatura; vira Free.
update public.alunos
   set metodo_arke_status = 'sem_adesao', nivel_atacado = null
 where metodo_arke_status = 'ativo' and nivel_atacado = 'essencial';

delete from public.organization_planos_precificacao where nivel_atacado = 'essencial';

create or replace function public.seed_precificacao_sugerida()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  insert into public.organization_planos_precificacao (organization_id, nivel_atacado, valor_varejo, markup_pct)
  select
    new.id,
    p.id,
    p.valor_sugerido_varejo,
    round(((p.valor_sugerido_varejo - p.custo_mensal) / p.custo_mensal) * 100, 2)
  from public.planos_atacado p
  where p.disponivel
  on conflict (organization_id, nivel_atacado) do nothing;
  return new;
end;
$$;

-- Método ativo só em nível disponível. Cobre todos os caminhos: adesão pela
-- academia, trial do Super Admin, matrícula e qualquer escrita da service_role.
create or replace function public.exigir_nivel_disponivel()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.metodo_arke_status = 'ativo'
     and (tg_op = 'INSERT'
          or old.metodo_arke_status is distinct from new.metodo_arke_status
          or old.nivel_atacado is distinct from new.nivel_atacado)
     and not exists (select 1 from public.planos_atacado p where p.id = new.nivel_atacado and p.disponivel) then
    raise exception 'Nível do Método ARKE indisponível. O Essencial foi substituído pelo plano Free: escolha Integrado ou Elite.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_exigir_nivel_disponivel
  before insert or update on public.alunos
  for each row execute function public.exigir_nivel_disponivel();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Prioridade por plano (D2)
-- ─────────────────────────────────────────────────────────────────────────
-- Plano do aluno: 'free', 'integrado' ou 'elite'. Nível gravado em quem não
-- está no Método é só intenção, não plano.
create or replace function public.plano_do_aluno(_metodo public.metodo_arke_status, _nivel public.nivel_atacado)
returns text
language sql
immutable
as $$
  select case
    when _metodo = 'ativo' and _nivel = 'elite' then 'elite'
    when _metodo = 'ativo' and _nivel = 'integrado' then 'integrado'
    else 'free'
  end;
$$;

-- A tarefa do Elite sobe um degrau de prioridade. Olhava só o nível, e aluno
-- fora do Método com nível antigo gravado também furava a fila.
create or replace function public.bump_prioridade_elite()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _plano text;
begin
  if new.aluno_id is not null then
    select public.plano_do_aluno(metodo_arke_status, nivel_atacado) into _plano from public.alunos where id = new.aluno_id;
    if _plano = 'elite' then
      if new.prioridade = 'baixa' then
        new.prioridade := 'media';
      elsif new.prioridade = 'media' then
        new.prioridade := 'alta';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Caixa de Mensagens: conversas esperando resposta primeiro, e entre elas o
-- Elite fura a fila e o Integrado vem antes do Free.
drop function if exists public.get_caixa_mensagens(uuid);
create function public.get_caixa_mensagens(_organization_id uuid)
returns table (
  aluno_id uuid,
  aluno_nome text,
  canal text,
  dieta_id uuid,
  ultima_mensagem text,
  ultima_em timestamptz,
  ultimo_remetente text,
  nao_lidas bigint,
  plano text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_org_staff(auth.uid(), _organization_id) or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  return query
  with msgs as (
    select m.aluno_id, 'treino'::text as canal, null::uuid as dieta_id, m.mensagem, m.created_at, m.remetente_tipo::text as remetente, m.lida
      from public.mensagens_treino m where m.organization_id = _organization_id
    union all
    select m.aluno_id, 'dieta', m.dieta_id, m.mensagem, m.created_at, m.remetente_tipo::text, m.lida
      from public.mensagens_dieta m where m.organization_id = _organization_id
  ),
  ultima as (
    select distinct on (x.aluno_id, x.canal) x.aluno_id, x.canal, x.dieta_id, x.mensagem, x.created_at, x.remetente
      from msgs x
     order by x.aluno_id, x.canal, x.created_at desc
  ),
  pendentes as (
    select x.aluno_id, x.canal, count(*) as n
      from msgs x where x.remetente = 'aluno' and not x.lida
     group by 1, 2
  )
  select u.aluno_id, coalesce(p.full_name, 'Aluno'), u.canal, u.dieta_id, left(u.mensagem, 160), u.created_at, u.remetente,
         coalesce(pe.n, 0), public.plano_do_aluno(a.metodo_arke_status, a.nivel_atacado)
    from ultima u
    join public.alunos a on a.id = u.aluno_id
    left join public.profiles p on p.user_id = a.user_id
    left join pendentes pe on pe.aluno_id = u.aluno_id and pe.canal = u.canal
   order by coalesce(pe.n, 0) > 0 desc,
            case public.plano_do_aluno(a.metodo_arke_status, a.nivel_atacado) when 'elite' then 2 when 'integrado' then 1 else 0 end desc,
            u.created_at desc;
end;
$$;

revoke execute on function public.get_caixa_mensagens(uuid) from public, anon;
grant execute on function public.get_caixa_mensagens(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Automações: só aluno em dia; ativação também no Free
-- ─────────────────────────────────────────────────────────────────────────
-- Ativação em 48h vale para quem entrou no Free por matrícula ou cadastro.
-- A base importada fica de fora: ela é ativada em bloco pelo convite de
-- primeiro acesso (QR Code), e 400 tarefas de uma vez afogariam a fila.
create or replace function public.gerar_tarefas_ativacao_pendente()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    a.organization_id,
    a.id,
    'Aluno sem 1º acesso após 48h',
    'alta',
    now() + interval '24 hours',
    'ativacao_pendente:' || a.id::text,
    'ativacao'
  from public.alunos a
  where a.primeiro_acesso_em is null
    and a.created_at < now() - interval '48 hours'
    and a.anonimizado_em is null
    and a.situacao_academia = 'em_dia'
    and (a.metodo_arke_status = 'ativo'
         or not exists (select 1 from public.importacoes_alunos_linhas l
                         where l.organization_id = a.organization_id and l.user_id_criado = a.user_id))
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

create or replace function public.gerar_tarefas_barreira_rotina()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _aluno record;
  _dias_previstos_sem_registro int;
  _cfg record;
begin
  select prioridade, prazo_horas into _cfg from public.sla_config where tipo = 'barreira';

  for _aluno in
    select distinct a.id as aluno_id, a.organization_id, a.dias_descanso
    from public.alunos a
    join public.treinos t on t.aluno_id = a.id and t.status = 'ativo'
    where a.situacao_academia = 'em_dia'
  loop
    select count(*)
    into _dias_previstos_sem_registro
    from generate_series(current_date - 7, current_date - 1, interval '1 day') as d(dia)
    where public.dia_e_esperado_treino(_aluno.aluno_id, extract(isodow from d.dia)::int, _aluno.dias_descanso)
      and not exists (
        select 1 from public.registro_treino r
        where r.aluno_id = _aluno.aluno_id
          and r.data = d.dia::date
          and r.concluido = true
      );

    if _dias_previstos_sem_registro >= 2 then
      insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
      values (
        _aluno.organization_id,
        _aluno.aluno_id,
        'Aluno com 2+ dias previstos de treino sem registro (possível barreira de rotina)',
        coalesce(_cfg.prioridade, 'media'),
        now() + make_interval(hours => coalesce(_cfg.prazo_horas, 24)),
        'barreira_rotina:' || _aluno.aluno_id::text || ':' || to_char(current_date, 'IYYY-IW'),
        'barreira'
      )
      on conflict (organization_id, origem_evento) do nothing;
    end if;
  end loop;
end;
$$;

create or replace function public.gerar_tarefas_engajamento_baixo()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _cfg record;
  _org record;
  _pontuacao record;
  _competencia text := to_char(current_date, 'YYYY-MM');
begin
  select prioridade, prazo_horas into _cfg from public.sla_config where tipo = 'engajamento_baixo';

  for _org in select id from public.organizations loop
    for _pontuacao in
      select pc.aluno_id, pc.pontuacao
      from public.calcular_pontuacoes_engajamento_mes(_org.id) pc
      join public.alunos a on a.id = pc.aluno_id
      where a.metodo_arke_status = 'ativo' and a.situacao_academia = 'em_dia' and pc.pontuacao < 30
    loop
      insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
      values (
        _org.id,
        _pontuacao.aluno_id,
        'Engajamento baixo neste mês (treino, check-in, dieta e água) — considerar contato proativo',
        coalesce(_cfg.prioridade, 'media'),
        now() + make_interval(hours => coalesce(_cfg.prazo_horas, 72)),
        'engajamento_baixo:' || _pontuacao.aluno_id::text || ':' || _competencia,
        'engajamento_baixo'
      )
      on conflict (organization_id, origem_evento) do nothing;
    end loop;
  end loop;
end;
$$;

create or replace function public.gerar_tarefas_acolhimento_elite()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _cfg record;
  _aluno record;
begin
  select prioridade, prazo_horas into _cfg from public.sla_config where tipo = 'acolhimento_elite';

  for _aluno in
    select a.id as aluno_id, a.organization_id
    from public.alunos a
    where a.nivel_atacado = 'elite' and a.metodo_arke_status = 'ativo'
      and a.situacao_academia = 'em_dia'
      and not exists (
        select 1 from public.tarefas t
        where t.aluno_id = a.id and t.tipo = 'acolhimento_elite'
          and t.created_at > now() - interval '30 days'
      )
  loop
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values (
      _aluno.organization_id,
      _aluno.aluno_id,
      'Acolhimento expandido Elite — agendar encontro periódico de acompanhamento',
      coalesce(_cfg.prioridade, 'baixa'),
      now() + make_interval(hours => coalesce(_cfg.prazo_horas, 168)),
      'acolhimento_elite:' || _aluno.aluno_id::text || ':' || to_char(current_date, 'IYYY-IW'),
      'acolhimento_elite'
    )
    on conflict (organization_id, origem_evento) do nothing;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Grupos musculares do app original (D7)
-- ─────────────────────────────────────────────────────────────────────────
insert into public.grupos_musculares (nome, ordem)
select v.nome, v.ordem
  from (values ('Peito', 1), ('Costas', 2), ('Ombros', 3), ('Bíceps', 4), ('Tríceps', 5), ('Pernas', 6),
               ('Glúteos', 7), ('Abdômen', 8), ('Antebraços', 9), ('Panturrilha', 10), ('Cardio', 11)) v(nome, ordem)
 where not exists (select 1 from public.grupos_musculares g where g.nome = v.nome);

update public.grupos_musculares g
   set ordem = v.ordem
  from (values ('Peito', 1), ('Costas', 2), ('Ombros', 3), ('Bíceps', 4), ('Tríceps', 5), ('Pernas', 6),
               ('Glúteos', 7), ('Abdômen', 8), ('Antebraços', 9), ('Panturrilha', 10), ('Cardio', 11)) v(nome, ordem)
 where g.nome = v.nome;

-- De-para dos grupos que saem, preservando a ordem (o primeiro é o
-- principal). "Braços" se divide pelo nome do exercício; posterior e
-- quadríceps viram Pernas, e os exercícios em que o glúteo manda ganham
-- Glúteos — como principal quando é o alvo (hip thrust, ponte).
create or replace function pg_temp.novos_grupos(_nome text, _grupos text[])
returns text[]
language plpgsql
as $$
declare
  r text[] := '{}';
  g text;
  novo text;
  gluteo_principal boolean := _nome ~* 'hip thrust|eleva[cç][aã]o p[eé]lvica|ponte de gl[uú]teo';
  gluteo_junto boolean := _nome ~* 'b[uú]lgaro|passada|afundo|sum[oô]|stiff|romeno|step up';
begin
  foreach g in array _grupos loop
    foreach novo in array (
      case
        when g = 'Braços' and _nome ~* 'tr[ií]ceps|mergulho|paralela|dip|coice' then array['Tríceps']
        when g = 'Braços' and _nome ~* 'inversa' then array['Bíceps', 'Antebraços']
        when g = 'Braços' then array['Bíceps']
        when g = 'Core' then array['Abdômen']
        when g in ('Quadríceps', 'Isquiotibiais') and gluteo_principal then array['Glúteos', 'Pernas']
        when g in ('Quadríceps', 'Isquiotibiais') and gluteo_junto then array['Pernas', 'Glúteos']
        when g in ('Quadríceps', 'Isquiotibiais') then array['Pernas']
        else array[g]
      end
    ) loop
      if not novo = any(r) then
        r := r || novo;
      end if;
    end loop;
  end loop;
  return r;
end;
$$;

update public.exercicios_biblioteca
   set grupos_musculares = pg_temp.novos_grupos(nome, grupos_musculares)
 where grupos_musculares && array['Braços', 'Core', 'Quadríceps', 'Isquiotibiais'];

-- Modelos de treino também guardam os grupos (text[]): acompanham o
-- exercício quando há vínculo; sem vínculo, o mesmo de-para pelo nome.
update public.modelo_treino_exercicios m
   set grupo_muscular = coalesce(
         (select e.grupos_musculares from public.exercicios_biblioteca e where e.id = m.exercicio_id),
         pg_temp.novos_grupos(m.nome_exercicio, m.grupo_muscular))
 where m.grupo_muscular && array['Braços', 'Core', 'Quadríceps', 'Isquiotibiais'];

delete from public.grupos_musculares where nome in ('Braços', 'Core', 'Quadríceps', 'Isquiotibiais');
