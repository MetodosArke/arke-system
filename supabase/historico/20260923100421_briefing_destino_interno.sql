-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- O briefing deixa de ir pelo WhatsApp (23/09/2026).
--
-- Descartado por governanca antes de tecnica: a conta da Meta esta num CNPJ
-- que o responsavel nao controla, e construir dependencia num canal de
-- terceiro e risco, nao detalhe. Junto foram embora a aprovacao de template e
-- a fragilidade dos parametros posicionais — bastava alguem mexer no template
-- para a mensagem sair com os numeros trocados de lugar, parecendo certa.
--
-- O relatorio passa a viver dentro do sistema, com push avisando e e-mail
-- levando o resumo. Por isso o que a funcao precisa devolver deixou de ser
-- telefone e passou a ser o `user_id` (para o push) e o e-mail do gestor.
drop function if exists public.briefing_semanal_organizacao(uuid);

create or replace function public.briefing_semanal_organizacao(_organization_id uuid)
returns table(
  organizacao_nome text,
  gestor_nome text,
  gestor_user_id uuid,
  gestor_email text,
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
         p.user_id,
         u.email::text,
         av.hoje::integer,
         av.antes::integer,
         case when av.antes > 0 then round(av.hoje::numeric * 100 / av.antes, 1) end,
         case when av.antes > 0 then round((av.hoje - av.antes)::numeric * 100 / av.antes, 1) end,
         (select count(*)::integer from public.alunos a
           where a.organization_id = _organization_id and a.created_at >= now() - interval '7 days'),
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
      select pr.full_name, pr.user_id
        from public.organization_members om
        join public.profiles pr on pr.user_id = om.user_id
       where om.organization_id = o.id and om.role = 'gestor' and om.status = 'active'
       order by om.created_at
       limit 1
    ) p on true
    left join auth.users u on u.id = p.user_id
   where o.id = _organization_id;
$$;

comment on function public.briefing_semanal_organizacao(uuid) is
  'Retrato semanal de uma academia. Todo numero tem formula fechada e reproduzivel no painel.';

revoke execute on function public.briefing_semanal_organizacao(uuid) from public;
grant execute on function public.briefing_semanal_organizacao(uuid) to authenticated, service_role;

-- A academia precisa ler o proprio relatorio: ate agora `briefings_enviados`
-- era so da ArkeFit, porque o destino era externo. Com o relatorio dentro do
-- sistema, o gestor e o leitor principal.
--
-- Uma regra por operacao: a condicao entra NA regra existente.
alter policy "leitura" on public.briefings_enviados
  using (
    is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

comment on table public.briefings_enviados is
  'Relatorio semanal gerado por academia. Guarda os numeros exatos da semana, para responder depois ao "mas o sistema me disse X".';
