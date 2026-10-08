-- Os níveis da equipe da ArkeFit, lote 3: o Mentor (08/10/2026).
--
-- O Mentor contratado atende o Método ARKE na Visão Master: a fila de
-- chamados, as conversas, a carteira e a ficha do aluno, a prescrição com o
-- registro profissional, as metas, a fase e a progressão, e a instrução
-- presencial à academia. Sempre e só com o aluno do Método: o aluno do Free é
-- da academia, e quando o aluno sai do Método o Mentor perde o acesso a ele
-- (`aluno_no_metodo`). O Mentor não tem `admin_arke` (nível nunca grava
-- `user_roles`), então nada do que a academia inteira vê pelo Admin ARKE chega
-- a ele: dinheiro, organizações, papéis, a carteira das academias.
--
-- O que muda:
--   1. o nível Mentor passa a poder ser dado (`niveis_arkefit_abertos`);
--   2. o registro profissional (CREF para treino, CRN para dieta) é sempre
--      exigido de quem não é Sócio, mesmo com `exigir_registro_metodo` em 0:
--      a dispensa da fase de testes vale só para o Sócio;
--   3. as regras de `tarefas` (4), `mensagens_mentor` (3),
--      `sentinela_sugestoes` (2), `aluno_consentimento_ia` e
--      `aluno_fase_historico` ganham o termo do Mentor:
--      `(select acesso_arkefit('mentoria'))` mais o aluno do Método. Nas
--      tarefas, só as da ArkeFit (`dono = 'arkefit'`), com aluno. O resumo da
--      anamnese já tinha o termo do Método (`equipe_metodo()`, 20261360);
--   4. as funções da fila (`get_superadmin_fila_mentor`, `get_fila_mentor`),
--      da instrução presencial e da jornada passam a perguntar pela área
--      `mentoria`, e para quem não é Sócio, só com o aluno do Método;
--   5. `mover_fase_jornada` e `liberar_progressao_aluno` aceitavam a equipe
--      do Método para qualquer aluno: o Mentor passa a valer só no do Método;
--   6. a ficha do aluno (`get_ficha_mentor`) mostra ao Mentor só os chamados
--      da ArkeFit e a instrução presencial (a cobrança e o atestado são da
--      academia);
--   7. atribuir o mentor do aluno passa a ser do Sócio, e o mentor atribuído é
--      conferido em `equipe_arkefit` (ativo e mentor), e não em `user_roles`.
--
-- Não muda: as regras de treino, dieta, anamnese, alunos, check-in e as
-- outras que já pediam `equipe_metodo() and aluno_no_metodo(...)`; elas
-- passam a valer para o Mentor pelo `equipe_metodo()` do lote 1.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. O nível Mentor está no ar
-- ---------------------------------------------------------------------------
create or replace function public.niveis_arkefit_abertos()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['mentor']::text[];
$$;

-- ---------------------------------------------------------------------------
-- 2. O registro profissional, sempre, para quem não é Sócio
-- ---------------------------------------------------------------------------
create or replace function public.pode_prescrever_treino_metodo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.equipe_metodo() and (
    (not public.registro_metodo_exigido() and public.has_role(auth.uid(), 'superadmin'))
    or exists (
      select 1 from public.equipe_arkefit e
       where e.user_id = auth.uid() and e.ativo and nullif(btrim(e.cref), '') is not null
    )
  );
$$;

create or replace function public.pode_prescrever_dieta_metodo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.equipe_metodo() and (
    (not public.registro_metodo_exigido() and public.has_role(auth.uid(), 'superadmin'))
    or exists (
      select 1 from public.equipe_arkefit e
       where e.user_id = auth.uid() and e.ativo and nullif(btrim(e.crn), '') is not null
    )
  );
$$;

-- A regra que vale para qualquer caminho, inclusive a chave de serviço: o
-- texto de 20261294010000, com a dispensa do registro só para o Sócio.
create or replace function public.definir_dono_da_prescricao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_metodo boolean;
  v_registro text;
  v_tipo_org public.organization_tipo;
begin
  select a.organization_id, a.metodo_arke_status = 'ativo', o.tipo
    into v_org, v_metodo, v_tipo_org
    from public.alunos a
    join public.organizations o on o.id = a.organization_id
   where a.id = new.aluno_id;

  if v_org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if new.organization_id is distinct from v_org then
    raise exception 'A prescrição tem de ser da organização do aluno.' using errcode = '22023';
  end if;

  if not v_metodo then
    -- No painel do autônomo, treino é do personal e dieta da nutricionista.
    -- Sem pessoa (rotina automática), segue como antes.
    if v_tipo_org = 'profissional_autonomo'
       and auth.uid() is not null
       and not public.equipe_metodo()
       and not public.papel_prescreve_no_autonomo(v_org, auth.uid(), case when tg_table_name = 'treinos' then 'treino' else 'dieta' end) then
      raise exception using
        errcode = '42501',
        message = case when tg_table_name = 'treinos'
          then 'Neste painel, o treino é prescrito pelo personal.'
          else 'Neste painel, a dieta é prescrita pela nutricionista.'
        end;
    end if;
    new.dono := 'academia';
    new.prescritor_registro := null;
    return new;
  end if;

  -- O registro é gravado sempre que existe, mesmo com a exigência desligada:
  -- a prescrição é imutável e deve dizer quem assinou.
  select case when tg_table_name = 'treinos' then nullif(btrim(e.cref), '') else nullif(btrim(e.crn), '') end
    into v_registro
    from public.equipe_arkefit e
   where e.user_id = auth.uid() and e.ativo;

  -- A exigência desligada (`exigir_registro_metodo` = 0) dispensa só o Sócio:
  -- o Mentor contratado prescreve sempre com o registro.
  if auth.uid() is null
     or not public.equipe_metodo()
     or ((public.registro_metodo_exigido() or not public.has_role(auth.uid(), 'superadmin')) and v_registro is null) then
    raise exception using
      errcode = '42501',
      message = case when tg_table_name = 'treinos'
        then 'Este aluno está no Método ARKE: o treino é prescrito pela equipe da ArkeFit, por um profissional com CREF.'
        else 'Este aluno está no Método ARKE: a dieta é prescrita pela equipe da ArkeFit, por um profissional com CRN.'
      end;
  end if;

  new.dono := 'arkefit';
  new.prescritor_registro := v_registro;
  return new;
end;
$$;

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.definir_dono_da_prescricao() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. As regras: o termo do Mentor, sempre com o aluno do Método
-- ---------------------------------------------------------------------------

-- Tarefas: o texto de 20261398010000, mais o Mentor nas tarefas da ArkeFit
-- de aluno do Método. A cobrança e o atestado (`dono = 'academia'`) não
-- chegam a ele, nem a tarefa da ArkeFit de aluno do Free.
alter policy "leitura" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  );

alter policy "inclusão" on public.tarefas
  with check (
    (aluno_id is not null and exists (
      select 1 from public.alunos a
       where a.id = tarefas.aluno_id and a.user_id = (select auth.uid()) and a.organization_id = tarefas.organization_id))
    or public.is_org_staff((select auth.uid()), organization_id)
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  );

alter policy "alteração" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  )
  with check (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  );

alter policy "exclusão" on public.tarefas
  using (
    (public.is_org_staff((select auth.uid()), organization_id) and dono = 'academia'
      and (not public.tarefa_de_saude(tipo::text) or public.atende_saude(organization_id)))
    or (public.has_role((select auth.uid()), 'admin_arke'::public.app_role) and dono = 'arkefit')
    or public.has_role((select auth.uid()), 'superadmin'::public.app_role)
    or ((select public.acesso_arkefit('mentoria')) and dono = 'arkefit' and aluno_id is not null and public.aluno_no_metodo(aluno_id))
  );

-- A conversa do Mentor (20261219010000): o Mentor lê, marca como lida e
-- escreve como `mentor`, só com o aluno do Método.
alter policy "leitura" on public.mensagens_mentor
  using (
    exists (select 1 from public.alunos a
             where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin_arke')
    or public.has_role((select auth.uid()), 'superadmin')
    or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))
  );

alter policy "inclusão" on public.mensagens_mentor
  with check (
    remetente_id = (select auth.uid())
    and (
      (remetente_tipo = 'aluno'
        and exists (select 1 from public.alunos a
                     where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid())))
      or (remetente_tipo = 'mentor'
        and (public.has_role((select auth.uid()), 'admin_arke')
          or public.has_role((select auth.uid()), 'superadmin')
          or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))))
    )
  );

alter policy "alteração" on public.mensagens_mentor
  using (
    exists (select 1 from public.alunos a
             where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin_arke')
    or public.has_role((select auth.uid()), 'superadmin')
    or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))
  )
  with check (
    exists (select 1 from public.alunos a
             where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin_arke')
    or public.has_role((select auth.uid()), 'superadmin')
    or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))
  );

-- A sugestão de resposta do Sentinela (o rascunho do Mentor).
alter policy "leitura" on public.sentinela_sugestoes
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
    or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))
  );

alter policy "alteração" on public.sentinela_sugestoes
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
    or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))
  )
  with check (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
    or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))
  );

-- As autorizações de IA do aluno (o Mentor vê se o aluno autorizou o
-- Sentinela). O texto de 20261229010000, mais o Mentor; consentir continua só
-- com o próprio aluno.
drop policy if exists "leitura" on public.aluno_consentimento_ia;
create policy "leitura" on public.aluno_consentimento_ia
  for select to authenticated
  using (
    exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = (select auth.uid()))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
    or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))
  );

-- O histórico de fases do aluno.
alter policy "staff da org vê o histórico de fases dos seus alunos" on public.aluno_fase_historico
  using (
    public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'admin_arke')
    or public.has_role((select auth.uid()), 'superadmin')
    or ((select public.acesso_arkefit('mentoria')) and public.aluno_no_metodo(aluno_id))
  );

-- O resumo da anamnese (`sentinela_anamnese`) não muda aqui: desde
-- 20261360010000 a leitura dele é `equipe_metodo() and aluno_no_metodo(...)`,
-- e o Mentor entra por ali com o `equipe_metodo()` do lote 1.

-- ---------------------------------------------------------------------------
-- 4. As funções da fila, da instrução presencial e da jornada
-- ---------------------------------------------------------------------------

-- As conversas na fila: para quem não é Sócio, só o aluno do Método.
create or replace function public.get_superadmin_fila_mentor()
returns table (
  aluno_id uuid,
  aluno_nome text,
  organizacao_nome text,
  plano text,
  ultima_mensagem text,
  ultima_em timestamptz,
  ultimo_remetente text,
  nao_lidas bigint
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_socio boolean;
begin
  if not public.acesso_arkefit('mentoria') then
    raise exception 'Apenas a ArkeFit acessa a fila de mentoria.'
      using errcode = 'insufficient_privilege';
  end if;
  v_socio := public.acesso_arkefit('socio');

  return query
  select a.id,
         coalesce(p.full_name, 'Aluno'),
         o.nome,
         public.plano_do_aluno(a.metodo_arke_status, a.nivel_atacado),
         ultima.mensagem,
         ultima.created_at,
         ultima.remetente_tipo::text,
         coalesce(pendentes.total, 0)
    from public.alunos a
    join public.organizations o on o.id = a.organization_id
    left join public.profiles p on p.user_id = a.user_id
    join lateral (
      select m.mensagem, m.created_at, m.remetente_tipo
        from public.mensagens_mentor m
       where m.aluno_id = a.id
       order by m.created_at desc
       limit 1
    ) ultima on true
    left join lateral (
      select count(*) as total
        from public.mensagens_mentor m
       where m.aluno_id = a.id and m.remetente_tipo = 'aluno' and not m.lida
    ) pendentes on true
   where v_socio or a.metodo_arke_status = 'ativo'
   -- Esperando resposta primeiro; entre elas, a mais antiga na frente, que é
   -- quem está esperando há mais tempo.
   order by (coalesce(pendentes.total, 0) > 0) desc,
            case when coalesce(pendentes.total, 0) > 0 then ultima.created_at end asc,
            ultima.created_at desc;
end;
$$;

revoke execute on function public.get_superadmin_fila_mentor() from public, anon;
grant execute on function public.get_superadmin_fila_mentor() to authenticated;

-- Os chamados da ArkeFit: para quem não é Sócio, só os de aluno do Método.
create or replace function public.get_fila_mentor(_limite integer default 200)
 returns table(tarefa_id uuid, aluno_id uuid, aluno_nome text, organizacao_id uuid, organizacao_nome text, tipo tarefa_tipo, motivo text,
               prioridade tarefa_prioridade, status tarefa_status, sla_prazo timestamp with time zone, atrasada boolean, fase fase_jornada,
               dias_inativo integer, constancia numeric, nivel text, nao_lidas bigint, total_fila bigint, total_atrasadas bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_socio boolean;
begin
  if not public.acesso_arkefit('mentoria') then
    raise exception 'Apenas a equipe da ArkeFit acessa a fila do Mentor.' using errcode = '42501';
  end if;
  v_socio := public.acesso_arkefit('socio');

  return query
  with fila as (
    select t.id, t.aluno_id, t.organization_id, t.tipo, t.motivo, t.prioridade, t.status, t.sla_prazo,
           (t.sla_prazo is not null and t.sla_prazo < now()) as atrasada,
           count(*) over () as total_fila,
           count(*) filter (where t.sla_prazo is not null and t.sla_prazo < now()) over () as total_atrasadas
      from public.tarefas t
     where t.dono = 'arkefit'
       and t.status in ('aberta', 'em_andamento', 'aguardando')
       and t.aluno_id is not null
       and (v_socio or exists (select 1 from public.alunos am where am.id = t.aluno_id and am.metodo_arke_status = 'ativo'))
     -- Vencida primeiro, depois prioridade, depois o prazo mais apertado: é a
     -- ordem em que a célula deve pegar, não a ordem de chegada.
     order by (t.sla_prazo is not null and t.sla_prazo < now()) desc, t.prioridade desc, t.sla_prazo nulls last
     limit greatest(1, least(coalesce(_limite, 200), 1000))
  )
  select f.id,
         a.id,
         coalesce(p.full_name, 'Aluno'),
         o.id,
         o.nome,
         f.tipo,
         f.motivo,
         f.prioridade,
         f.status,
         f.sla_prazo,
         f.atrasada,
         a.fase_jornada,
         public.aluno_dias_inativo(a.id),
         public.aluno_constancia(a.id, 4),
         a.nivel_atacado::text,
         (select count(*) from public.mensagens_mentor m
           where m.aluno_id = a.id and m.remetente_tipo = 'aluno' and not m.lida),
         f.total_fila,
         f.total_atrasadas
    from fila f
    join public.alunos a on a.id = f.aluno_id
    join public.organizations o on o.id = f.organization_id
    left join public.profiles p on p.user_id = a.user_id
   order by f.atrasada desc, f.prioridade desc, f.sla_prazo nulls last;
end;
$function$;

revoke execute on function public.get_fila_mentor(integer) from public, anon;
grant execute on function public.get_fila_mentor(integer) to authenticated;

-- A instrução presencial à academia: o Mentor manda só sobre aluno do Método.
create or replace function public.criar_instrucao_presencial(
  _aluno_id uuid,
  _instrucao text,
  _prioridade public.tarefa_prioridade default 'alta',
  _prazo_horas integer default 24
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _org uuid;
  _metodo boolean;
  _id uuid;
begin
  if not public.acesso_arkefit('mentoria') then
    raise exception 'Apenas a equipe da ArkeFit envia instrução presencial.' using errcode = '42501';
  end if;
  if coalesce(btrim(_instrucao), '') = '' then
    raise exception 'Descreva a instrução — a academia precisa saber o que fazer no acolhimento.';
  end if;

  select organization_id, metodo_arke_status = 'ativo' into _org, _metodo from public.alunos where id = _aluno_id;
  if _org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if not _metodo and not public.acesso_arkefit('socio') then
    raise exception 'Este aluno não está no Método ARKE.' using errcode = '42501';
  end if;

  insert into public.tarefas
    (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo, dono)
  values
    (_org, _aluno_id, btrim(_instrucao), _prioridade,
     now() + make_interval(hours => greatest(_prazo_horas, 1)),
     -- Idempotência por instante: duas instruções diferentes no mesmo aluno
     -- são legítimas, um clique duplicado não.
     'instrucao_mentor:' || _aluno_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
     'instrucao_presencial', 'academia')
  on conflict (organization_id, origem_evento) do nothing
  returning id into _id;

  return _id;
end;
$$;

revoke execute on function public.criar_instrucao_presencial(uuid, text, public.tarefa_prioridade, integer) from public, anon;
grant execute on function public.criar_instrucao_presencial(uuid, text, public.tarefa_prioridade, integer) to authenticated;

-- A jornada (motivo de não avançar, fase elegível, constância): a academia, o
-- próprio aluno, o Sócio e o Admin ARKE (gestor de toda academia) como antes;
-- o Mentor, só no aluno do Método.
create or replace function public.get_jornada_aluno(_aluno_id uuid)
returns table (motivo text, elegivel public.fase_jornada, constancia numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_user uuid;
  v_metodo boolean;
begin
  select a.organization_id, a.user_id, a.metodo_arke_status = 'ativo' into v_org, v_user, v_metodo
    from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  if not (public.is_org_staff(auth.uid(), v_org)
          or public.acesso_arkefit('socio')
          or public.has_role(auth.uid(), 'admin_arke')
          or (v_metodo and public.acesso_arkefit('mentoria'))
          or v_user = auth.uid()) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  return query select public.motivo_nao_avanca(_aluno_id),
                      public.fase_elegivel(_aluno_id),
                      public.aluno_constancia(_aluno_id, 4);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A fase e a progressão: o Mentor só no aluno do Método
-- ---------------------------------------------------------------------------
-- O texto de 20261292010000. Antes, `equipe_metodo()` sozinho passava para
-- qualquer aluno (era só o Sócio); o Sócio e o Admin ARKE seguem assim, e o
-- Mentor passa só com o aluno do Método.
create or replace function public.mover_fase_jornada(_aluno_id uuid, _fase fase_jornada, _observacao text default null::text)
returns fase_jornada
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_atual public.fase_jornada;
  v_metodo boolean;
  v_nome text;
begin
  select a.organization_id, a.fase_jornada, a.metodo_arke_status = 'ativo'
    into v_org, v_atual, v_metodo
    from public.alunos a
   where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;
  if not (public.acesso_arkefit('socio')
          or public.has_role(auth.uid(), 'admin_arke')
          or (v_metodo and public.equipe_metodo())
          or (public.is_org_staff(auth.uid(), v_org) and not v_metodo)) then
    if v_metodo then
      raise exception 'Este aluno está no Método ARKE: a fase da jornada é conduzida pelo mentor da ArkeFit.' using errcode = '42501';
    end if;
    raise exception 'Apenas a equipe da academia ou a ArkeFit podem mover a fase da jornada.';
  end if;
  if v_atual = _fase then
    return v_atual;
  end if;
  select p.full_name into v_nome from public.profiles p where p.user_id = auth.uid();
  update public.alunos set fase_jornada = _fase where id = _aluno_id;
  insert into public.aluno_fase_historico (organization_id, aluno_id, fase_anterior, fase_nova, movido_por, movido_por_nome, observacao)
  values (v_org, _aluno_id, v_atual, _fase, auth.uid(), v_nome, nullif(btrim(_observacao), ''));
  return _fase;
end;
$function$;

create or replace function public.liberar_progressao_aluno(_aluno_id uuid, _observacao text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _org uuid;
  _metodo boolean;
begin
  select organization_id, metodo_arke_status = 'ativo' into _org, _metodo from public.alunos where id = _aluno_id;
  if _org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null
     and not (public.acesso_arkefit('socio')
              or public.has_role(auth.uid(), 'admin_arke')
              or (_metodo and public.equipe_metodo())
              or (public.is_org_staff(auth.uid(), _org) and not _metodo)) then
    if _metodo then
      raise exception 'Este aluno está no Método ARKE: quem libera a progressão é o mentor da ArkeFit.' using errcode = '42501';
    end if;
    raise exception 'Só a equipe da academia ou a ArkeFit liberam a progressão.' using errcode = '42501';
  end if;
  update public.alunos set progressao_bloqueada_em = null, progressao_bloqueada_motivo = null where id = _aluno_id;
  insert into public.aluno_observacoes (organization_id, aluno_id, autor_id, texto)
  values (_org, _aluno_id, auth.uid(), coalesce(nullif(trim(_observacao), ''), 'Progressão liberada após avaliação do relato de dor.'));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. A ficha do aluno: ao Mentor, só os chamados da ArkeFit
-- ---------------------------------------------------------------------------
-- O texto de 20261293010000. A ficha já recusa o aluno do Free; os chamados
-- abertos do aluno, que traziam os da academia (a cobrança, o atestado),
-- chegam ao Mentor só se forem da ArkeFit, ou a instrução presencial que ele
-- mesmo mandou. O Sócio vê todos, como antes.
create or replace function public.get_ficha_mentor(_aluno_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos%rowtype;
  v jsonb;
  v_socio boolean;
begin
  if not public.equipe_metodo() then
    raise exception 'Apenas a ArkeFit abre a ficha do aluno do Método.' using errcode = '42501';
  end if;
  v_socio := public.acesso_arkefit('socio') or public.has_role(auth.uid(), 'admin_arke');

  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  -- Aluno do Free é da academia: a ficha dele não abre aqui.
  if v_aluno.metodo_arke_status <> 'ativo' then
    raise exception 'Este aluno não está no Método ARKE.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'aluno', jsonb_build_object(
      'id', v_aluno.id,
      'nome', coalesce(p.full_name, 'Aluno'),
      'telefone', p.phone,
      'organization_id', v_aluno.organization_id,
      'organizacao_nome', o.nome,
      'plano', public.plano_do_aluno(v_aluno.metodo_arke_status, v_aluno.nivel_atacado),
      'fase', v_aluno.fase_jornada,
      'fase_desde', public.aluno_fase_desde(v_aluno.id),
      'metodo_desde', v_aluno.metodo_arke_ativado_em,
      'data_nascimento', v_aluno.data_nascimento,
      'situacao_academia', v_aluno.situacao_academia,
      'objetivo', v_aluno.objetivo,
      'meta_semanal_dias', v_aluno.meta_semanal_dias,
      'meta_agua_ml', v_aluno.meta_agua_ml,
      'mentor_id', v_aluno.mentor_id,
      'mentor_nome', coalesce(pm.full_name, um.email),
      'mentor_desde', v_aluno.mentor_desde,
      'progressao_bloqueada_em', v_aluno.progressao_bloqueada_em,
      'progressao_bloqueada_motivo', v_aluno.progressao_bloqueada_motivo,
      'dias_inativo', public.aluno_dias_inativo(v_aluno.id),
      'constancia', public.aluno_constancia(v_aluno.id, 4)
    ),
    'anamnese', (select to_jsonb(an) - 'organization_id' from public.anamnese_acolhimento an where an.aluno_id = v_aluno.id),
    'treino', (
      select jsonb_build_object('id', t.id, 'titulo', t.titulo, 'validade_inicio', t.validade_inicio,
                                'validade_fim', t.validade_fim, 'snapshot', t.snapshot_conteudo, 'dono', t.dono,
                                'prescritor_registro', t.prescritor_registro, 'publicado_em', t.created_at,
                                'publicado_por', coalesce(pt.full_name, 'equipe'))
        from public.treinos t left join public.profiles pt on pt.user_id = t.publicado_por
       where t.aluno_id = v_aluno.id and t.status = 'ativo'
       order by t.created_at desc limit 1
    ),
    'dieta', (
      select jsonb_build_object('id', d.id, 'titulo', d.titulo, 'snapshot', d.snapshot_conteudo,
                                'observacoes_gerais', d.observacoes_gerais, 'dono', d.dono,
                                'prescritor_registro', d.prescritor_registro, 'publicado_em', d.created_at,
                                'publicado_por', coalesce(pd.full_name, 'equipe'))
        from public.dietas d left join public.profiles pd on pd.user_id = d.publicado_por
       where d.aluno_id = v_aluno.id and d.status = 'ativo'
       order by d.created_at desc limit 1
    ),
    'checkins', coalesce((
      select jsonb_agg(c order by c.created_at desc)
        from (select ck.status, ck.comentario, ck.motivo_dificuldade, ck.data, ck.created_at
                from public.checkins ck where ck.aluno_id = v_aluno.id
               order by ck.created_at desc limit 12) c
    ), '[]'::jsonb),
    'treinos_registrados', coalesce((
      select jsonb_agg(r order by r.data desc)
        from (select rt.data, rt.divisao, rt.concluido, rt.sensacao, rt.esforco_percebido, rt.duracao_min, rt.observacao
                from public.registro_treino rt
               where rt.aluno_id = v_aluno.id and rt.data >= current_date - 28
               order by rt.data desc limit 40) r
    ), '[]'::jsonb),
    'adesao_dieta', coalesce((
      select jsonb_agg(x order by x.data desc)
        from (select da.data, da.adesao_percentual, da.agua_ml, da.consumiu_doce, da.consumiu_alcool, da.observacoes
                from public.dieta_adesao da
               where da.aluno_id = v_aluno.id and da.data >= current_date - 14
               order by da.data desc) x
    ), '[]'::jsonb),
    'avaliacoes', coalesce((
      select jsonb_agg(av order by av.data_avaliacao desc)
        from (select a2.data_avaliacao, a2.peso_kg, a2.altura_cm, a2.imc, a2.percentual_gordura,
                     a2.musculo_percentual, a2.perim_cintura, a2.perim_abdomen, a2.perim_quadril,
                     a2.dores_relatadas, a2.observacoes, a2.data_proxima_avaliacao
                from public.avaliacoes_fisicas a2 where a2.aluno_id = v_aluno.id
               order by a2.data_avaliacao desc limit 6) av
    ), '[]'::jsonb),
    'chamados', coalesce((
      select jsonb_agg(tk order by tk.sla_prazo)
        from (select tf.id, tf.tipo, tf.motivo, tf.prioridade, tf.status, tf.sla_prazo, tf.dono,
                     tf.sla_prazo < now() as atrasado
                from public.tarefas tf
               where tf.aluno_id = v_aluno.id and tf.status in ('aberta', 'em_andamento', 'aguardando')
                 and (v_socio or tf.dono = 'arkefit' or tf.tipo = 'instrucao_presencial')
               order by tf.sla_prazo limit 20) tk
    ), '[]'::jsonb)
  ) into v
  from public.organizations o
  left join public.profiles p on p.user_id = v_aluno.user_id
  left join public.profiles pm on pm.user_id = v_aluno.mentor_id
  left join auth.users um on um.id = v_aluno.mentor_id
  where o.id = v_aluno.organization_id;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Atribuir o mentor do aluno: o Sócio, e o mentor conferido na equipe
-- ---------------------------------------------------------------------------
create or replace function public.atribuir_mentor_aluno(_aluno_id uuid, _mentor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Só um sócio da ArkeFit define o mentor do aluno.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.alunos a where a.id = _aluno_id and a.metodo_arke_status = 'ativo') then
    raise exception 'O aluno não está no Método ARKE.' using errcode = '22023';
  end if;
  -- O mentor é quem a equipe diz que atende como mentor, ativo: o Mentor
  -- contratado (nível Mentor) ou o sócio com "Atende como mentor" ligado.
  if _mentor_id is not null and not exists (
    select 1 from public.equipe_arkefit e where e.user_id = _mentor_id and e.ativo and e.mentor
  ) then
    raise exception 'Essa pessoa não atende como mentor na equipe da ArkeFit.' using errcode = '22023';
  end if;

  update public.alunos
     set mentor_id = _mentor_id,
         mentor_desde = case when _mentor_id is null then null else now() end
   where id = _aluno_id
     and mentor_id is distinct from _mentor_id;
end;
$$;

revoke execute on function public.atribuir_mentor_aluno(uuid, uuid) from public, anon;
grant execute on function public.atribuir_mentor_aluno(uuid, uuid) to authenticated;
