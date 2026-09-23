-- Fase 5c do Ecossistema: o briefing semanal do gestor (23/09/2026).
--
-- O Sentinela manda ao dono da academia, toda segunda, o retrato da base dele.
--
-- **Sem LLM, de propósito.** Os números saem de SQL; um modelo só formataria a
-- frase — e introduziria a chance de **inventar um número numa mensagem
-- assinada pela ArkeFit, no WhatsApp do dono**. Num relatório isso é o pior
-- defeito possível: destrói confiança mais rápido do que a ausência do
-- relatório a construiria. A inteligência aqui é escolher o que importa, e
-- disso SQL dá conta.
--
-- **Toda métrica tem fórmula fechada e reproduzível no painel.** Um número que
-- o gestor não consegue conferir vale menos que nenhum número.

-- ── Retenção: a fórmula acordada ───────────────────────────────────────────
--
-- Ativo = tem presença ou treino registrado nos últimos 30 dias.
-- Retenção do mês = ativos hoje ÷ ativos há 30 dias.
--
-- Contar pelo sinal de uso, e não por `situacao_academia`, é deliberado: a
-- situação é marcada à mão pela recepção e atrasa; quem parou de aparecer há
-- três semanas ainda consta "em dia". Retenção medida assim mediria o
-- cadastro, não o comportamento.
create or replace function public.aluno_ativo_em(_aluno_id uuid, _referencia date, _janela integer default 30)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.presencas p
     where p.aluno_id = _aluno_id and p.dia > _referencia - _janela and p.dia <= _referencia
    union all
    select 1 from public.registro_treino r
     where r.aluno_id = _aluno_id and r.concluido
       and r.data > _referencia - _janela and r.data <= _referencia
  );
$$;

comment on function public.aluno_ativo_em(uuid, date, integer) is
  'Aluno com presenca ou treino registrado na janela. Mede comportamento, nao cadastro.';

/**
 * O retrato semanal de uma academia.
 *
 * Devolve uma linha com tudo que entra na mensagem, para o compositor não
 * precisar fazer conta — e para os números serem os mesmos que o painel mostra.
 */
create or replace function public.briefing_semanal_organizacao(_organization_id uuid)
returns table(
  organizacao_nome text,
  gestor_nome text,
  gestor_telefone text,
  alunos_ativos integer,
  alunos_ativos_mes_passado integer,
  retencao_pct numeric,
  variacao_pct numeric,
  novos_na_semana integer,
  em_risco integer,
  resgates_do_mentor integer,
  chamados_para_a_academia integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select a.id
      from public.alunos a
     where a.organization_id = _organization_id
       and a.situacao_academia <> 'pausado'
  ),
  ativos as (
    select count(*) filter (where public.aluno_ativo_em(b.id, current_date)) as hoje,
           count(*) filter (where public.aluno_ativo_em(b.id, current_date - 30)) as antes
      from base b
  )
  select o.nome,
         coalesce(p.full_name, 'gestor'),
         coalesce(nullif(btrim(p.phone), ''), nullif(btrim(o.telefone), '')),
         av.hoje::integer,
         av.antes::integer,
         -- Retenção só faz sentido com base anterior: sem ela, qualquer
         -- divisão seria por zero ou um 100% que não quer dizer nada.
         case when av.antes > 0 then round(av.hoje::numeric * 100 / av.antes, 1) end,
         case when av.antes > 0 then round((av.hoje - av.antes)::numeric * 100 / av.antes, 1) end,
         (select count(*)::integer from public.alunos a
           where a.organization_id = _organization_id and a.created_at >= now() - interval '7 days'),
         -- Em risco = o que a fila do Mentor está tratando agora.
         (select count(*)::integer from public.tarefas t
           where t.organization_id = _organization_id and t.dono = 'arkefit'
             and t.tipo = 'inercia' and t.status in ('aberta','em_andamento','aguardando')),
         (select count(*)::integer from public.tarefas t
           where t.organization_id = _organization_id and t.dono = 'arkefit'
             and t.status = 'concluida' and t.updated_at >= now() - interval '7 days'),
         (select count(*)::integer from public.tarefas t
           where t.organization_id = _organization_id and t.tipo = 'instrucao_presencial'
             and t.status in ('aberta','em_andamento','aguardando'))
    from public.organizations o
    cross join ativos av
    left join lateral (
      select pr.full_name, pr.phone
        from public.organization_members om
        join public.profiles pr on pr.user_id = om.user_id
       where om.organization_id = o.id and om.role = 'gestor' and om.status = 'active'
       order by om.created_at
       limit 1
    ) p on true
   where o.id = _organization_id;
$$;

comment on function public.briefing_semanal_organizacao(uuid) is
  'Retrato semanal de uma academia para o briefing do gestor. Todo numero tem formula fechada e reproduzivel no painel.';

revoke execute on function public.aluno_ativo_em(uuid, date, integer) from public;
revoke execute on function public.briefing_semanal_organizacao(uuid) from public;
grant execute on function public.aluno_ativo_em(uuid, date, integer) to authenticated, service_role;
grant execute on function public.briefing_semanal_organizacao(uuid) to authenticated, service_role;
