-- Fase 3 do Ecossistema: o motor de avanço automático (23/09/2026).
--
-- Reverte conscientemente uma decisão registrada. O projeto dizia: "as cinco
-- fases são movidas pela equipe, manualmente. A decisão foi não automatizar:
-- quem convive com o aluno é quem sabe se ele mudou de fase."
--
-- O modelo de **Mentor Centralizado** removeu a premissa dessa decisão. Não há
-- mais um professor acompanhando digitalmente — esse é o ponto do BPO. Então
-- automatizar o fluxo de sucesso e reservar o humano para as exceções é
-- coerente, não é um recuo. A passagem manual continua valendo por cima
-- (`mover_fase_jornada`), e o histórico distingue quem moveu.
--
-- Os critérios vieram do conceito e das decisões de 23/09/2026:
--
--   M.A.P.A.  → B.A.S.E.   anamnese concluída
--   B.A.S.E.  → R.O.T.A.    4 semanas na fase com constância >= 80%
--   R.O.T.A.  → A.P.E.X.   12 semanas na fase com constância >= 80%
--   A.P.E.X.  → L.E.G.A.D.O. 24 semanas de Método com constância >= 80%
--
-- **Tempo na fase é exigido junto com a constância, e não é detalhe.** A
-- constância olha para trás; sem o tempo mínimo, um aluno que entra hoje em
-- B.A.S.E. carregando quatro semanas boas da fase anterior avançaria no mesmo
-- dia — pulando exatamente o ciclo de adaptação que a fase existe para dar.

-- ── Quem não avança ────────────────────────────────────────────────────────
--
-- Cada bloqueio devolve o motivo, e não só um "não": a fila do Mentor (Fase 4)
-- precisa saber **por que** o aluno parou para decidir o que fazer. Um
-- booleano obrigaria a refazer a pergunta.
create or replace function public.motivo_nao_avanca(_aluno_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when a.metodo_arke_status is distinct from 'ativo' then 'fora_do_metodo'
           when a.situacao_academia is distinct from 'em_dia' then 'situacao_' || a.situacao_academia::text
           when a.progressao_bloqueada_em is not null then 'dor'
           -- Inércia: o conceito diz que o avanço é suspenso, não que o aluno
           -- regride. Quem sumiu não colhe progresso de um período em que não
           -- apareceu, e o caso vai para o Mentor em vez de andar sozinho.
           when coalesce(public.aluno_dias_inativo(a.id), 0) >= 5 then 'inercia'
           else null
         end
    from public.alunos a
   where a.id = _aluno_id;
$$;

comment on function public.motivo_nao_avanca(uuid) is
  'Por que o aluno nao avanca de fase agora, ou NULL se nada impede. O motivo alimenta a fila do Mentor.';

-- ── Para onde o aluno deveria ir ───────────────────────────────────────────
--
-- Só olha para a frente e um passo por vez: nunca pula fase e nunca regride.
-- Pular seria dar por cumprido um ciclo que não aconteceu; regredir
-- automaticamente tiraria do aluno um progresso que ele de fato fez, e é
-- decisão de gente.
create or replace function public.fase_elegivel(_aluno_id uuid)
returns public.fase_jornada
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _a record;
  _semanas_na_fase numeric;
begin
  select a.id, a.fase_jornada, a.created_at
    into _a
    from public.alunos a
   where a.id = _aluno_id;
  if not found or public.motivo_nao_avanca(_aluno_id) is not null then
    return null;
  end if;

  _semanas_na_fase := (current_date - public.aluno_fase_desde(_aluno_id))::numeric / 7;

  if _a.fase_jornada = 'mapa' then
    if exists (
      select 1 from public.anamnese_acolhimento an
       where an.aluno_id = _aluno_id and an.concluida_em is not null
    ) then
      return 'base';
    end if;
    return null;
  end if;

  if _a.fase_jornada = 'base' then
    if _semanas_na_fase >= 4 and coalesce(public.aluno_constancia(_aluno_id, 4), 0) >= 80 then
      return 'rota';
    end if;
    return null;
  end if;

  if _a.fase_jornada = 'rota' then
    if _semanas_na_fase >= 12 and coalesce(public.aluno_constancia(_aluno_id, 12), 0) >= 80 then
      return 'apex';
    end if;
    return null;
  end if;

  if _a.fase_jornada = 'apex' then
    -- "24 semanas de constancia acumulada **no Metodo**": conta da matricula,
    -- nao da entrada em A.P.E.X. — senao o total pediria mais de um ano.
    if (current_date - (_a.created_at at time zone 'America/Sao_Paulo')::date) >= 168
       and coalesce(public.aluno_constancia(_aluno_id, 24), 0) >= 80 then
      return 'legado';
    end if;
    return null;
  end if;

  -- L.E.G.A.D.O. e o fim da regua.
  return null;
end;
$$;

comment on function public.fase_elegivel(uuid) is
  'Proxima fase que o aluno ja conquistou, ou NULL. Um passo por vez: nunca pula fase nem regride.';

-- ── O movimento ────────────────────────────────────────────────────────────
--
-- `mover_fase_jornada` exige papel de equipe e morreria no cron, onde
-- `auth.uid()` é nulo. Esta é a porta do motor: sem checagem de papel porque
-- não há usuário, e **restrita à service_role** justamente por isso.
--
-- O histórico grava `movido_por` nulo com o nome "Avanço automático", que é o
-- que permite, depois, separar o que o sistema fez do que a equipe fez.
create or replace function public.avancar_fase_automatico(_aluno_id uuid)
returns public.fase_jornada
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _org uuid;
  _atual public.fase_jornada;
  _proxima public.fase_jornada;
begin
  _proxima := public.fase_elegivel(_aluno_id);
  if _proxima is null then
    return null;
  end if;

  select a.organization_id, a.fase_jornada into _org, _atual
    from public.alunos a where a.id = _aluno_id;

  update public.alunos set fase_jornada = _proxima where id = _aluno_id;

  insert into public.aluno_fase_historico
    (organization_id, aluno_id, fase_anterior, fase_nova, movido_por, movido_por_nome, observacao)
  values
    (_org, _aluno_id, _atual, _proxima, null, 'Avanço automático',
     'Critérios da fase cumpridos: constância e tempo mínimo.');

  return _proxima;
end;
$$;

comment on function public.avancar_fase_automatico(uuid) is
  'Move o aluno uma fase quando os criterios foram cumpridos. Grava o historico como avanco automatico.';

revoke execute on function public.avancar_fase_automatico(uuid) from public;
grant execute on function public.avancar_fase_automatico(uuid) to service_role;

-- ── A varredura ────────────────────────────────────────────────────────────
--
-- Só alunos do Método com a organização liberada: fase é recurso do Método, e
-- academia com onboarding pendente não deve ver aluno andando sozinho.
create or replace function public.varrer_avanco_fases()
returns table(avancados integer, avaliados integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _a record;
  _n integer := 0;
  _t integer := 0;
begin
  for _a in
    select al.id
      from public.alunos al
      join public.organizations o on o.id = al.organization_id
     where al.metodo_arke_status = 'ativo'
       and al.situacao_academia = 'em_dia'
       and al.fase_jornada <> 'legado'
       and (o.onboarding_completed or o.status = 'trial')
  loop
    _t := _t + 1;
    if public.avancar_fase_automatico(_a.id) is not null then
      _n := _n + 1;
    end if;
  end loop;
  return query select _n, _t;
end;
$$;

comment on function public.varrer_avanco_fases() is
  'Varredura diaria do avanco automatico de fases. So alunos do Metodo, em dia e com a academia liberada.';

revoke execute on function public.varrer_avanco_fases() from public;
grant execute on function public.varrer_avanco_fases() to service_role;

revoke execute on function public.motivo_nao_avanca(uuid) from public;
revoke execute on function public.fase_elegivel(uuid) from public;
grant execute on function public.motivo_nao_avanca(uuid) to authenticated, service_role;
grant execute on function public.fase_elegivel(uuid) to authenticated, service_role;
