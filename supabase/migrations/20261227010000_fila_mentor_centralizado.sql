-- Fase 4 do Ecossistema: a fila do Mentor Centralizado (23/09/2026).
--
-- O modelo de BPO tira a carga de acompanhamento digital das costas da
-- academia: quando o aluno foge do fluxo automático, quem atua é a célula da
-- ArkeFit, não o professor. A academia recebe **instrução presencial**, não
-- trabalho digital.
--
-- **A fila do Mentor é a mesma tabela `tarefas`, com dono.** Não uma tabela
-- nova. O motor de tarefas já tem SLA, escalonamento, desfecho obrigatório e
-- idempotência por `origem_evento`, tudo em produção e testado — duplicar isso
-- daria duas implementações de "o que fazer quando resolve", que divergem na
-- primeira correção feita só num lado. É a mesma razão de a reconciliação
-- reenviar o evento ao próprio webhook em vez de reimplementar o efeito.

-- ── 1. Quem é o dono da tarefa ─────────────────────────────────────────────
alter table public.tarefas
  add column if not exists dono text not null default 'academia';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarefas_dono_valido') then
    alter table public.tarefas add constraint tarefas_dono_valido check (dono in ('academia', 'arkefit'));
  end if;
end $$;

comment on column public.tarefas.dono is
  'Quem atua: a equipe da academia ou a celula de Mentor da ArkeFit. Decidido por dono_da_tarefa().';

create index if not exists idx_tarefas_fila_mentor
  on public.tarefas (dono, status, sla_prazo)
  where dono = 'arkefit';

/**
 * Quem deve atuar numa tarefa.
 *
 * A regra é o produto, não o tipo: **o que é do Método é da ArkeFit; o que é
 * da relação da academia com o aluno é da academia.** Por isso cobrança e
 * atestado ficam sempre com a academia mesmo para aluno do Método — dinheiro
 * e documento são a relação dela, e o Mentor não tem como resolver nem um nem
 * outro. E aluno no plano Free não tem Mentor: a academia segue dona da fila
 * dele inteira.
 */
create or replace function public.dono_da_tarefa(_aluno_id uuid, _tipo public.tarefa_tipo)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when _tipo in ('cobranca', 'atestado', 'instrucao_presencial') then 'academia'
           when exists (
             select 1 from public.alunos a
              where a.id = _aluno_id and a.metodo_arke_status = 'ativo'
           ) then 'arkefit'
           else 'academia'
         end;
$$;

comment on function public.dono_da_tarefa(uuid, public.tarefa_tipo) is
  'Quem atua: ArkeFit no que e do Metodo, academia no que e da relacao dela (cobranca, atestado, instrucao presencial) e em todo aluno Free.';

create or replace function public.definir_dono_da_tarefa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Só no insert e só quando ninguém escolheu: a instrução presencial nasce
  -- com dono explícito, e realocar uma tarefa à mão tem de continuar valendo.
  if new.dono is null or new.dono = 'academia' then
    new.dono := public.dono_da_tarefa(new.aluno_id, new.tipo);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_definir_dono_da_tarefa on public.tarefas;
create trigger trg_definir_dono_da_tarefa
  before insert on public.tarefas
  for each row execute function public.definir_dono_da_tarefa();

revoke execute on function public.definir_dono_da_tarefa() from public;

-- As tarefas que já existem seguem a mesma regra, para a fila não nascer
-- mentindo sobre a base atual.
update public.tarefas t
   set dono = public.dono_da_tarefa(t.aluno_id, t.tipo)
 where t.status in ('aberta', 'em_andamento', 'aguardando');

-- ── 2. A ArkeFit enxerga a fila dela atravessando academias ────────────────
--
-- É o único lugar do sistema que lê alunos de várias organizações de uma vez,
-- e por isso a checagem de papel é a primeira linha: sem ela, esta função
-- seria um vazamento de base inteira.
--
-- Devolve o **contexto da decisão** junto, não só a tarefa. O mentor precisa
-- saber dias inativo, constância e fase para escolher entre resgatar, ajustar
-- ou acionar a academia — e buscar isso aluno a aluno seria uma consulta por
-- linha da fila, que é o que mata a produtividade da célula.
create or replace function public.get_fila_mentor()
returns table(
  tarefa_id uuid,
  aluno_id uuid,
  aluno_nome text,
  organizacao_id uuid,
  organizacao_nome text,
  tipo public.tarefa_tipo,
  motivo text,
  prioridade public.tarefa_prioridade,
  status public.tarefa_status,
  sla_prazo timestamptz,
  atrasada boolean,
  fase public.fase_jornada,
  dias_inativo integer,
  constancia numeric,
  nivel text,
  nao_lidas bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Apenas a equipe da ArkeFit acessa a fila do Mentor.' using errcode = '42501';
  end if;

  return query
  select t.id,
         a.id,
         coalesce(p.full_name, 'Aluno'),
         o.id,
         o.nome,
         t.tipo,
         t.motivo,
         t.prioridade,
         t.status,
         t.sla_prazo,
         (t.sla_prazo is not null and t.sla_prazo < now()),
         a.fase_jornada,
         public.aluno_dias_inativo(a.id),
         public.aluno_constancia(a.id, 4),
         a.nivel_atacado::text,
         (select count(*) from public.mensagens_mentor m
           where m.aluno_id = a.id and m.remetente_tipo = 'aluno' and not m.lida)
    from public.tarefas t
    join public.alunos a on a.id = t.aluno_id
    join public.organizations o on o.id = t.organization_id
    left join public.profiles p on p.user_id = a.user_id
   where t.dono = 'arkefit'
     and t.status in ('aberta', 'em_andamento', 'aguardando')
   -- Vencida primeiro, depois prioridade, depois o prazo mais apertado: é a
   -- ordem em que a célula deve pegar, não a ordem de chegada.
   order by (t.sla_prazo is not null and t.sla_prazo < now()) desc,
            t.prioridade desc,
            t.sla_prazo nulls last;
end;
$$;

comment on function public.get_fila_mentor() is
  'Fila da celula de Mentor da ArkeFit, atravessando organizacoes, com o contexto da decisao em cada linha.';

revoke execute on function public.get_fila_mentor() from public;
grant execute on function public.get_fila_mentor() to authenticated;

-- ── 3. A academia recebe instrução, não trabalho ───────────────────────────
--
-- O caminho de volta do BPO. O Mentor investigou, decidiu e já agiu no app; o
-- que sobra para a academia é o que só acontece presencialmente. Nasce com
-- dono `academia` explícito — é o único caso em que a tarefa de um aluno do
-- Método não é da ArkeFit, e é de propósito.
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
  _id uuid;
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Apenas a equipe da ArkeFit envia instrução presencial.' using errcode = '42501';
  end if;
  if coalesce(btrim(_instrucao), '') = '' then
    raise exception 'Descreva a instrução — a academia precisa saber o que fazer no acolhimento.';
  end if;

  select organization_id into _org from public.alunos where id = _aluno_id;
  if _org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
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

comment on function public.criar_instrucao_presencial(uuid, text, public.tarefa_prioridade, integer) is
  'Mentor da ArkeFit manda para a academia o que so acontece presencialmente. Nasce com dono academia de proposito.';

revoke execute on function public.criar_instrucao_presencial(uuid, text, public.tarefa_prioridade, integer) from public;
grant execute on function public.criar_instrucao_presencial(uuid, text, public.tarefa_prioridade, integer) to authenticated;

-- ── 4. O gatilho de inércia ────────────────────────────────────────────────
--
-- "Aluno sem abrir o app ou sem check-in por 5 dias" — o sinal de evasão do
-- conceito. Os sensores da Fase 2 já sabem responder; faltava transformar a
-- resposta em fila.
--
-- Idempotente por aluno e por janela de inatividade, e não por dia: sem isso,
-- um aluno sumido há três semanas geraria uma tarefa nova toda madrugada e
-- afogaria a célula com o mesmo caso.
create or replace function public.gerar_tarefas_inercia()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _a record;
  _n integer := 0;
begin
  for _a in
    select al.id, al.organization_id, public.aluno_dias_inativo(al.id) as dias
      from public.alunos al
      join public.organizations o on o.id = al.organization_id
     where al.metodo_arke_status = 'ativo'
       and al.situacao_academia = 'em_dia'
       and (o.onboarding_completed or o.status = 'trial')
       -- Quem nunca deu sinal é caso de ativação, que já tem rotina própria.
       and public.aluno_dias_inativo(al.id) is not null
       and public.aluno_dias_inativo(al.id) >= 5
  loop
    insert into public.tarefas
      (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values
      (_a.organization_id, _a.id,
       'Risco de evasão — sem sinal de vida há ' || _a.dias || ' dias',
       -- O cast é obrigatório: o `case` devolve texto e a coluna é enum, e o
       -- plpgsql só reclama disso em execução, nunca na criação da função.
       (case when _a.dias >= 10 then 'critica' else 'alta' end)::public.tarefa_prioridade,
       now() + interval '24 hours',
       -- A janela de 5 em 5 dias: o mesmo sumiço não reabre todo dia, mas um
       -- agravamento (5 -> 10 -> 15 dias) merece um chamado novo.
       'inercia:' || _a.id::text || ':' || ((_a.dias / 5) * 5)::text,
       'inercia')
    on conflict (organization_id, origem_evento) do nothing;
    if found then
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end;
$$;

comment on function public.gerar_tarefas_inercia() is
  'Abre tarefa de risco de evasao para quem sumiu ha 5+ dias. Idempotente por janela de 5 dias, nao por dia.';

revoke execute on function public.gerar_tarefas_inercia() from public;
grant execute on function public.gerar_tarefas_inercia() to service_role;

revoke execute on function public.dono_da_tarefa(uuid, public.tarefa_tipo) from public;
grant execute on function public.dono_da_tarefa(uuid, public.tarefa_tipo) to authenticated, service_role;

-- ── 5. A fila do Mentor não aparece para a academia ────────────────────────
--
-- Sem isto o BPO quebra na primeira tela: o gestor continuaria vendo as
-- tarefas que a ArkeFit assumiu, e a promessa de "zero carga digital" viraria
-- uma lista maior do que antes — agora com casos que ele nem deve tratar.
--
-- A trava mora no RLS e não nas consultas porque são seis telas lendo
-- `tarefas` hoje, e a sétima nasceria sem o filtro. Aqui nenhuma esquece.
--
-- A condição entra NA regra existente, e não numa regra nova: uma segunda
-- regra permissiva se somaria por OU e justamente anularia o filtro. É a
-- regra "uma por operação" do projeto, e aqui ela também é correção.
alter policy "leitura" on public.tarefas
  using (
    (is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

alter policy "alteração" on public.tarefas
  using (
    (is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

alter policy "exclusão" on public.tarefas
  using (
    (is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

-- ── 6. O `with check` das tarefas nunca teve `superadmin` ──────────────────
--
-- Achado ao exercitar o console do Mentor: o Super Admin passava no USING e
-- era recusado no WITH CHECK, então a ArkeFit nunca conseguiu **alterar** uma
-- tarefa — só ler. Não doía porque não havia console; com a fila do Mentor,
-- encerrar um chamado é a ação principal da tela.
--
-- A armadilha é que `alter policy ... using (...)` muda só o using. Quem
-- corrige uma regra de UPDATE precisa lembrar das duas metades, e o sintoma de
-- esquecer é uma atualização que responde sucesso com zero linhas — o mesmo
-- silêncio que já custou o `primeiro_acesso_em` nulo para todo mundo.
alter policy "alteração" on public.tarefas
  with check (
    is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

alter policy "inclusão" on public.tarefas
  with check (
    (
      aluno_id is not null
      and exists (
        select 1 from public.alunos a
         where a.id = tarefas.aluno_id
           and a.user_id = (select auth.uid())
           and a.organization_id = tarefas.organization_id
      )
    )
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );
