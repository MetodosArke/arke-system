-- Os níveis da equipe da ArkeFit, lote 7: a limpeza (08/10/2026).
--
-- Fecha a entrega dos níveis:
--   1. os avisos por e-mail de uma área vão também a quem cuida dela
--      (`emails_da_area`): o aviso de dinheiro (a troca da carteira de
--      recebimento) ao Financeiro, e o técnico (as rotinas e as catracas fora
--      do ar) ao Suporte. Os outros avisos seguem só para os sócios
--      (`emails_superadmin`); ver o registro;
--   2. as funções do Sócio que aceitavam o Admin ARKE como alternativa passam
--      a conferir só o `superadmin` (o Admin ARKE é gestor de toda academia, e
--      só os sócios o têm, junto do `superadmin`). O texto de cada uma é o da
--      última migration que a definiu; muda só a conferência de quem chama;
--   3. as regras que chamavam `equipe_metodo()` linha a linha passam a chamá-lo
--      uma vez por consulta, em `(select ...)`. A resposta não depende da linha
--      (só da sessão), então o resultado é o mesmo; o custo cai (a medição está
--      no registro). O texto de cada regra é o vigente; muda só o embrulho;
--   4. a simulação de perfil (`impersonar-perfil`) e o encerramento passam a
--      ser só do Sócio, nas funções publicadas.
--
-- A coluna `equipe_arkefit.mentor` NÃO sai aqui: a tela publicada ainda a lê.
-- Ela sai numa migration depois do deploy do app desta entrega.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Os e-mails de quem cuida de cada área
-- ---------------------------------------------------------------------------
-- Os sócios, sempre (como `emails_superadmin`), e a equipe contratada ativa
-- com um nível que abre a área, com a conta pronta (senha e duas etapas): o
-- aviso leva para a Visão Master, que sem as duas etapas não abre. O `case` é
-- o mesmo de `acesso_arkefit()` e de `NIVEIS_DA_AREA` (src/lib/acessosArkefit.ts);
-- `acessosArkefit.guarda.test.ts` falha se divergirem. Só para as funções do
-- servidor (service role).
create or replace function public.emails_da_area(_area text)
returns table (email text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_niveis text[];
begin
  v_niveis := case _area
    when 'carteira'   then array['suporte', 'comercial', 'financeiro']
    when 'cadastro'   then array['comercial']
    when 'comercial'  then array['comercial']
    when 'suporte'    then array['suporte']
    when 'operacao'   then array['suporte']
    when 'mentoria'   then array['mentor']
    when 'financeiro' then array['financeiro']
    when 'socio'      then array[]::text[]
  end;
  if v_niveis is null then
    raise exception 'Área desconhecida: %', coalesce(_area, '(nula)') using errcode = '22023';
  end if;

  return query
  select distinct u.email::text
    from auth.users u
   where u.email is not null
     and u.deleted_at is null
     and (exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'superadmin')
          or (exists (select 1 from public.equipe_arkefit e
                       where e.user_id = u.id and e.ativo and e.niveis && v_niveis)
              and public.estado_conta_arkefit(u.id) = 'ativo'));
end;
$$;

comment on function public.emails_da_area(text) is
  'Os e-mails de quem cuida de uma área da Visão Master: os sócios e a equipe contratada ativa (senha e duas etapas) com um nível que abre a área. Só para a service role.';

revoke execute on function public.emails_da_area(text) from public, anon, authenticated;
grant execute on function public.emails_da_area(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. As funções do Sócio: só o superadmin
-- ---------------------------------------------------------------------------
-- O texto de 20261298010000.
create or replace function public.definir_agente_comercial(_ativo boolean, _agenda_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_agenda text := nullif(btrim(_agenda_url), '');
  v_estava boolean;
begin
  if not public.has_role(v_uid, 'superadmin') then
    raise exception 'Só a ArkeFit configura a resposta automática.' using errcode = '42501';
  end if;
  if v_agenda is not null and v_agenda !~ '^https://[^[:space:]]+$' then
    raise exception 'O link da agenda precisa começar com https://.' using errcode = '22023';
  end if;
  if _ativo and v_agenda is null then
    raise exception 'Cadastre o link da agenda antes de ligar a resposta automática.' using errcode = '22023';
  end if;

  select valor = 1 into v_estava from public.plataforma_config where chave = 'agente_comercial_ativo';

  update public.plataforma_textos set valor = v_agenda, updated_at = now(), updated_by = v_uid
   where chave = 'agenda_demonstracao_url';
  update public.plataforma_config set valor = case when _ativo then 1 else 0 end, updated_at = now(), updated_by = v_uid
   where chave = 'agente_comercial_ativo';
  -- Ligar marca a hora: quem pediu contato antes disso já foi atendido por
  -- gente e não recebe a primeira mensagem de repente.
  if _ativo and not coalesce(v_estava, false) then
    update public.plataforma_textos set valor = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF'), updated_at = now(), updated_by = v_uid
     where chave = 'agente_comercial_ativado_em';
  end if;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  select v_uid, u.email, case when _ativo then 'agente_comercial.ligar' else 'agente_comercial.desligar' end,
         'plataforma_config', null, jsonb_build_object('ativo', _ativo, 'agenda', v_agenda)
    from (select 1) um
    left join auth.users u on u.id = v_uid;
end;
$$;

-- O texto de 20261315010000.
create or replace function public.definir_agente_implantacao(_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.has_role(v_uid, 'superadmin') then
    raise exception 'Só a ArkeFit liga o agente de implantação.' using errcode = '42501';
  end if;
  update public.plataforma_config set valor = case when _ativo then 1 else 0 end, updated_at = now(), updated_by = v_uid
   where chave = 'agente_implantacao_ativo';
  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  select v_uid, u.email, case when _ativo then 'agente_implantacao.ligar' else 'agente_implantacao.desligar' end,
         'plataforma_config', null, jsonb_build_object('ativo', _ativo)
    from (select 1) um
    left join auth.users u on u.id = v_uid;
end;
$$;

-- O texto de 20261230010000.
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
  if not public.has_role(auth.uid(), 'superadmin') then
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

-- O texto de 20261230010000.
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
  if not public.has_role(auth.uid(), 'superadmin') then
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

-- O texto de 20261273010000.
create or replace function public.vigia_dispensar(_origem text, _id bigint, _indice integer default null, _motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o public.vigia_ocorrencias;
  a public.vigia_analises;
  ac jsonb;
  v_ferramenta text;
  v_nome text;
begin
  if not public.has_role(v_uid, 'superadmin') then
    raise exception 'Só a ArkeFit decide as ações do Vigia.' using errcode = '42501';
  end if;
  if _origem = 'regra' then
    update public.vigia_ocorrencias
       set decisao = 'dispensada', decidida_por = v_uid, decidida_em = now(), decisao_motivo = left(nullif(btrim(_motivo), ''), 300)
     where id = _id and decisao is null and fechada_em is null
    returning * into o;
    if o.id is null then
      raise exception 'Esta ocorrência já foi decidida ou já foi resolvida.';
    end if;
    select ferramenta into v_ferramenta from public.vigia_regras where codigo = o.regra;
    insert into public.vigia_acoes (origem, ocorrencia_id, ferramenta, alvo_nome, organization_id, forma, decidido_por, resultado, detalhe)
    values ('regra', o.id, v_ferramenta, o.descricao, o.organization_id, 'dispensada', v_uid, 'dispensada', left(_motivo, 300));
  elsif _origem = 'analise' then
    select * into a from public.vigia_analises where id = _id;
    ac := a.acoes -> _indice;
    if a.id is null or ac is null then
      raise exception 'Ação não encontrada.';
    end if;
    v_ferramenta := ac->>'ferramenta';
    v_nome := coalesce(a.mapa -> (ac->>'alvo') ->> 'nome', ac->>'alvo');
    begin
      insert into public.vigia_acoes (origem, analise_id, indice, ferramenta, alvo_nome, forma, decidido_por, resultado, detalhe)
      values ('analise', a.id, _indice, v_ferramenta, v_nome, 'dispensada', v_uid, 'dispensada', left(_motivo, 300));
    exception when unique_violation then
      raise exception 'Esta ação já foi decidida.';
    end;
  else
    raise exception 'Origem inválida.';
  end if;
end;
$$;

-- O texto de 20261273010000.
create or replace function public.definir_modo_regra_vigia(_codigo text, _modo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_antes text;
begin
  if not public.has_role(v_uid, 'superadmin') then
    raise exception 'Só a ArkeFit muda o modo das regras do Vigia.' using errcode = '42501';
  end if;
  select modo into v_antes from public.vigia_regras where codigo = _codigo;
  if v_antes is null then
    raise exception 'Regra não encontrada.';
  end if;
  update public.vigia_regras set modo = _modo where codigo = _codigo;
  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, detalhes)
  select v_uid, u.email, 'vigia.modo_regra', 'vigia_regras',
         jsonb_build_object('regra', _codigo, 'de', v_antes, 'para', _modo)
    from (select 1) um left join auth.users u on u.id = v_uid;
end;
$$;

-- O texto de 20261272010000.
create or replace function public.definir_vigia_ativo(_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not public.has_role(v_uid, 'superadmin') then
    raise exception 'Só a ArkeFit liga ou desliga o Vigia.' using errcode = '42501';
  end if;
  update public.plataforma_config
     set valor = case when _ativo then 1 else 0 end, updated_by = v_uid, updated_at = now()
   where chave = 'vigia_ativo'
  returning id into v_id;
  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, detalhes)
  select v_uid, u.email, case when _ativo then 'vigia.ligar' else 'vigia.desligar' end, 'plataforma_config', v_id,
         jsonb_build_object('ativo', _ativo)
    from (select 1) um
    left join auth.users u on u.id = v_uid;
end;
$$;

-- O texto de 20261273010000.
create or replace function public.vigia_preparar_aprovacao(_uid uuid, _origem text, _id bigint, _indice integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.vigia_ocorrencias;
  r public.vigia_regras;
  a public.vigia_analises;
  ac jsonb;
  v_ferramenta text;
  v_alvo text;
  v_nome text;
  v_ctx jsonb := '{}'::jsonb;
  v_org uuid;
  v_acao bigint;
begin
  if not public.has_role(_uid, 'superadmin') then
    raise exception 'Só a ArkeFit aprova ações do Vigia.' using errcode = '42501';
  end if;

  if _origem = 'regra' then
    select * into o from public.vigia_ocorrencias where id = _id for update;
    if o.id is null then
      raise exception 'Ocorrência não encontrada.';
    end if;
    select * into r from public.vigia_regras where codigo = o.regra;
    if o.fechada_em is not null then
      raise exception 'O problema já foi resolvido — não há o que aprovar.';
    end if;
    if o.decisao is not null then
      raise exception 'Esta ocorrência já foi decidida.';
    end if;
    if r.nivel <> 2 or o.acao_prevista_em is null then
      raise exception 'Esta ocorrência não está aguardando aprovação.';
    end if;
    v_ferramenta := r.ferramenta;
    v_alvo := case r.ferramenta
                when 'reexecutar_rotina' then o.contexto->>'rotina'
                when 'cancelar_assinatura_orfa' then o.contexto->>'assinatura'
                when 'reprocessar_evento_asaas' then o.contexto->>'tipo_evento' end;
    v_nome := o.descricao;
    v_ctx := o.contexto;
    v_org := o.organization_id;
    update public.vigia_ocorrencias set decisao = 'aprovada', decidida_por = _uid, decidida_em = now() where id = o.id;
    insert into public.vigia_acoes (origem, ocorrencia_id, ferramenta, alvo, alvo_nome, organization_id, forma, decidido_por, resultado)
    values ('regra', o.id, v_ferramenta, v_alvo, v_nome, v_org, 'aprovada', _uid, 'executando')
    returning id into v_acao;

  elsif _origem = 'analise' then
    select * into a from public.vigia_analises where id = _id;
    if a.id is null or a.status <> 'ok' then
      raise exception 'Análise não encontrada.';
    end if;
    if a.criada_em < now() - interval '12 hours' then
      raise exception 'Análise de mais de 12 horas — o quadro mudou desde então.';
    end if;
    ac := a.acoes -> _indice;
    if ac is null then
      raise exception 'Ação não encontrada.';
    end if;
    v_ferramenta := ac->>'ferramenta';
    if ac ? 'recusada' or not public.vigia_ferramenta_executavel(v_ferramenta)
       or v_ferramenta = 'cancelar_assinatura_orfa' then
      raise exception 'Esta ação não é executada pelo Vigia.';
    end if;
    -- O pseudônimo da análise vira o alvo de verdade pelo mapa, que nunca
    -- saiu do banco.
    v_alvo := coalesce(a.mapa -> (ac->>'alvo') ->> 'id', ac->>'alvo');
    v_nome := coalesce(a.mapa -> (ac->>'alvo') ->> 'nome', ac->>'alvo');
    if a.mapa -> (ac->>'alvo') ->> 'tipo' = 'catraca' then
      select organization_id into v_org from public.organizacao_catracas where id = v_alvo::uuid;
    elsif a.mapa -> (ac->>'alvo') ->> 'tipo' = 'organizacao' then
      v_org := v_alvo::uuid;
    end if;
    v_ctx := case when v_ferramenta = 'reprocessar_evento_asaas' then jsonb_build_object('tipo_evento', v_alvo) else '{}'::jsonb end;
    begin
      insert into public.vigia_acoes (origem, analise_id, indice, ferramenta, alvo, alvo_nome, organization_id, forma, decidido_por, resultado)
      values ('analise', a.id, _indice, v_ferramenta, v_alvo, v_nome, v_org, 'aprovada', _uid, 'executando')
      returning id into v_acao;
    exception when unique_violation then
      raise exception 'Esta ação já foi decidida.';
    end;
  else
    raise exception 'Origem inválida.';
  end if;

  return jsonb_build_object('acao_id', v_acao, 'ferramenta', v_ferramenta, 'alvo', v_alvo, 'alvo_nome', v_nome, 'contexto', v_ctx);
end;
$$;

-- O texto de 20261333010000.
create or replace function public.get_superadmin_uso_ia(_dias integer default 30)
returns table (
  agente text,
  chamadas integer,
  ok integer,
  recusadas_trava integer,
  indisponiveis integer,
  tokens_entrada bigint,
  tokens_saida bigint,
  custo_usd numeric,
  latencia_media_ms integer,
  latencia_max_ms integer,
  sem_preco boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query
  select c.agente,
         count(*)::int,
         count(*) filter (where c.resultado = 'ok')::int,
         count(*) filter (where c.resultado = 'recusada_trava')::int,
         count(*) filter (where c.resultado = 'indisponivel')::int,
         coalesce(sum(c.tokens_entrada), 0)::bigint,
         coalesce(sum(c.tokens_saida), 0)::bigint,
         round(coalesce(sum(coalesce(c.tokens_entrada, 0) * p.entrada_usd_por_milhao
                          + coalesce(c.tokens_saida, 0) * p.saida_usd_por_milhao) / 1000000, 0), 4),
         avg(c.latencia_ms)::int,
         max(c.latencia_ms)::int,
         bool_or(p.modelo is null and c.tokens_entrada is not null)
    from public.ia_chamadas c
    left join public.ia_precos p on p.modelo = c.modelo
   where c.feita_em > now() - make_interval(days => greatest(1, least(coalesce(_dias, 30), 400)))
   group by c.agente
   order by c.agente;
end;
$$;

revoke execute on function public.definir_agente_comercial(boolean, text) from public, anon;
grant execute on function public.definir_agente_comercial(boolean, text) to authenticated;
revoke execute on function public.definir_agente_implantacao(boolean) from public, anon;
grant execute on function public.definir_agente_implantacao(boolean) to authenticated;
revoke execute on function public.get_operacao_mentor(integer) from public, anon;
grant execute on function public.get_operacao_mentor(integer) to authenticated;
revoke execute on function public.get_carga_mentores(integer) from public, anon;
grant execute on function public.get_carga_mentores(integer) to authenticated;
revoke execute on function public.vigia_dispensar(text, bigint, integer, text) from public, anon;
grant execute on function public.vigia_dispensar(text, bigint, integer, text) to authenticated;
revoke execute on function public.definir_modo_regra_vigia(text, text) from public, anon;
grant execute on function public.definir_modo_regra_vigia(text, text) to authenticated;
revoke execute on function public.definir_vigia_ativo(boolean) from public, anon;
grant execute on function public.definir_vigia_ativo(boolean) to authenticated;
revoke execute on function public.get_superadmin_uso_ia(integer) from public, anon;
grant execute on function public.get_superadmin_uso_ia(integer) to authenticated;
-- Chamada pela função vigia-aprovar, com a service role, com quem pediu.
revoke execute on function public.vigia_preparar_aprovacao(uuid, text, bigint, integer) from public, anon, authenticated;
grant execute on function public.vigia_preparar_aprovacao(uuid, text, bigint, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. equipe_metodo() uma vez por consulta
-- ---------------------------------------------------------------------------
-- As 25 expressões (em 19 regras) que o chamavam linha a linha, com o texto
-- vigente de cada regra; muda só `equipe_metodo()` para
-- `(select public.equipe_metodo())`. Gerado do texto vigente pelo leitor das
-- regras das guardas; o roteiro de produção confere que, tirado o embrulho,
-- cada regra ficou igual à de antes.
alter policy "leitura" on public.alunos
  using (user_id = (select auth.uid()) or public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke') or (metodo_arke_status = 'ativo' and (select public.equipe_metodo())));
alter policy "leitura" on public.anamnese_acolhimento
  using (exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid())) or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id)) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "inclusão" on public.anamnese_acolhimento
  with check (exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid())) or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id)) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "alteração" on public.anamnese_acolhimento
  using (exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid())) or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id)) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)))
  with check (exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid())) or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id)) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "exclusão" on public.anamnese_acolhimento
  using (exists (select 1 from public.alunos a where a.id = anamnese_acolhimento.aluno_id and a.user_id = (select auth.uid())) or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id)) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "leitura" on public.avaliacoes_fisicas
  using (aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid())) or public.atende_saude(organization_id) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "leitura" on public.checkins
  using (exists (select 1 from public.alunos a where a.id = checkins.aluno_id and a.user_id = (select auth.uid())) or public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke') or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "leitura" on public.dieta_adesao
  using (exists (select 1 from public.alunos a where a.id = dieta_adesao.aluno_id and a.user_id = (select auth.uid())) or public.atende_saude(organization_id) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "leitura" on public.dietas
  using (exists (select 1 from public.alunos a where a.id = dietas.aluno_id and a.user_id = (select auth.uid())) or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id)) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "leitura" on public.mensagens_dieta
  using ((exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid()))) or public.atende_saude(organization_id) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "inclusão" on public.mensagens_dieta
  with check (( (exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid()))) and remetente_id = (select auth.uid()) and remetente_tipo = 'aluno'::public.remetente_tipo_dieta ) or ( (public.atende_saude(organization_id) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id))) and remetente_id = (select auth.uid()) and remetente_tipo = 'nutricionista'::public.remetente_tipo_dieta ));
alter policy "alteração" on public.mensagens_dieta
  using ((exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid()))) or public.atende_saude(organization_id) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)))
  with check ((exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid()))) or public.atende_saude(organization_id) or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "staff da org gerencia refeições de modelos de dieta" on public.modelo_dieta_refeicoes
  using (exists ( select 1 from public.modelos_dieta m where m.id = modelo_dieta_refeicoes.modelo_id and (is_org_staff((select auth.uid()), m.organization_id) or has_role((select auth.uid()), 'admin_arke') or (m.biblioteca = 'metodo' and (select public.equipe_metodo()))) ))
  with check (exists ( select 1 from public.modelos_dieta m where m.id = modelo_dieta_refeicoes.modelo_id and (is_org_staff((select auth.uid()), m.organization_id) or has_role((select auth.uid()), 'admin_arke') or (m.biblioteca = 'metodo' and (select public.equipe_metodo()))) ));
alter policy "staff da org gerencia exercícios de modelos de treino" on public.modelo_treino_exercicios
  using (exists ( select 1 from public.modelos_treino m where m.id = modelo_treino_exercicios.modelo_id and (is_org_staff((select auth.uid()), m.organization_id) or has_role((select auth.uid()), 'admin_arke') or (m.biblioteca = 'metodo' and (select public.equipe_metodo()))) ))
  with check (exists ( select 1 from public.modelos_treino m where m.id = modelo_treino_exercicios.modelo_id and (is_org_staff((select auth.uid()), m.organization_id) or has_role((select auth.uid()), 'admin_arke') or (m.biblioteca = 'metodo' and (select public.equipe_metodo()))) ));
alter policy "staff da org gerencia modelos de dieta" on public.modelos_dieta
  using (is_org_staff((select auth.uid()), organization_id) or has_role((select auth.uid()), 'admin_arke') or (biblioteca = 'metodo' and (select public.equipe_metodo())))
  with check (is_org_staff((select auth.uid()), organization_id) or has_role((select auth.uid()), 'admin_arke') or (biblioteca = 'metodo' and (select public.equipe_metodo())));
alter policy "staff da org gerencia modelos de treino" on public.modelos_treino
  using (is_org_staff((select auth.uid()), organization_id) or has_role((select auth.uid()), 'admin_arke') or (biblioteca = 'metodo' and (select public.equipe_metodo())))
  with check (is_org_staff((select auth.uid()), organization_id) or has_role((select auth.uid()), 'admin_arke') or (biblioteca = 'metodo' and (select public.equipe_metodo())));
alter policy "leitura" on public.registro_treino
  using (exists (select 1 from public.alunos a where a.id = registro_treino.aluno_id and a.user_id = (select auth.uid())) or public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke') or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "leitura" on public.treino_calendario
  using (exists (select 1 from public.alunos a where a.id = treino_calendario.aluno_id and a.user_id = (select auth.uid())) or public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke') or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));
alter policy "leitura" on public.treinos
  using (exists (select 1 from public.alunos a where a.id = treinos.aluno_id and a.user_id = (select auth.uid())) or public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke') or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id)));

-- O resumo da anamnese (o texto de 20261360010000): fora do leitor das
-- guardas, porque a criação da tabela não está no retrato do histórico.
alter policy "leitura" on public.sentinela_anamnese
  using (
    exists (select 1 from public.alunos a where a.id = sentinela_anamnese.aluno_id and a.user_id = (select auth.uid()))
    or (public.atende_saude(organization_id) and not public.aluno_no_metodo(aluno_id))
    or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id))
  );
