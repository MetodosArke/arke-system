-- A Visão Master com conta só de Super Admin (24/09/2026).
--
-- Rodando a Fase 0 pela tela com uma conta que tem apenas o papel
-- `superadmin`, a ficha da organização ficou em "Carregando…" na mensalidade
-- B2B, a taxa de implantação veio sem o valor de referência e o quadro de
-- atividade respondeu erro. Das quatro contas da ArkeFit, duas têm só esse
-- papel, e para elas isso é o que a tela mostra todo dia.
--
-- Três tabelas que a Visão Master lê direto ainda davam acesso só a
-- `admin_arke`, papel de antes de o Super Admin existir. Aqui entra o
-- `superadmin` nelas, e só nelas: nas tabelas com dado de aluno (alunos,
-- perfis, pagamentos) o Super Admin não lê pelo RLS por desenho, e a Visão
-- Master chega lá pelas funções `get_superadmin_*`, que entregam só o que a
-- tela precisa. As regras continuam uma por operação: cada uma é alterada
-- no lugar, nunca somada a outra.

-- organizations: a ficha lê plano, status, mensalidade e repasse.
alter policy "leitura" on public.organizations
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
    or is_org_member((select auth.uid()), id)
  );

-- organization_planos_precificacao: a exceção de repasse por nível é
-- configurada pela ArkeFit na ficha (Repasse do Método). A leitura também
-- perde a repetição de `admin_arke` que a consolidação de 21/09 deixou.
alter policy "leitura" on public.organization_planos_precificacao
  using (
    has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
    or is_org_member((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );
alter policy "inclusão" on public.organization_planos_precificacao
  with check (
    has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );
alter policy "alteração" on public.organization_planos_precificacao
  using (
    has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  )
  with check (
    has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );
alter policy "exclusão" on public.organization_planos_precificacao
  using (
    has_org_role((select auth.uid()), organization_id, 'gestor'::app_role)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

-- plataforma_config: Visão Master → Configurações (taxas, limite do banco,
-- valor de referência da taxa de implantação). Quem lê do lado da academia
-- passa por funções `security definer`, então a regra é só da ArkeFit.
alter policy "admin_arke gerencia plataforma_config" on public.plataforma_config
  rename to "ArkeFit gerencia plataforma_config";
alter policy "ArkeFit gerencia plataforma_config" on public.plataforma_config
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  )
  with check (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

-- Atividade recente da organização: numa função `returns table`, o nome
-- `data` da coluna de saída não é visível ao `order by` de um `union`, e a
-- função respondia 0A000 em toda chamada desde que nasceu. Ordena-se pela
-- posição da coluna.
create or replace function public.get_superadmin_organizacao_atividade(_organization_id uuid)
returns table(tipo text, data timestamp with time zone, descricao text, aluno_id uuid, aluno_nome text, responsavel_nome text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  select 'treino'::text, t.created_at, t.titulo, t.aluno_id, pa.full_name, ps.full_name
  from public.treinos t
  left join public.alunos a on a.id = t.aluno_id
  left join public.profiles pa on pa.user_id = a.user_id
  left join public.profiles ps on ps.user_id = t.publicado_por
  where t.organization_id = _organization_id

  union all

  select 'dieta'::text, d.created_at, d.titulo, d.aluno_id, pa.full_name, ps.full_name
  from public.dietas d
  left join public.alunos a on a.id = d.aluno_id
  left join public.profiles pa on pa.user_id = a.user_id
  left join public.profiles ps on ps.user_id = d.publicado_por
  where d.organization_id = _organization_id

  union all

  select 'avaliacao'::text, av.data_avaliacao::timestamptz, 'Avaliação física'::text, av.aluno_id, pa.full_name, ps.full_name
  from public.avaliacoes_fisicas av
  left join public.alunos a on a.id = av.aluno_id
  left join public.profiles pa on pa.user_id = a.user_id
  left join public.profiles ps on ps.user_id = av.avaliado_por
  where av.organization_id = _organization_id

  union all

  select 'tarefa'::text, tf.updated_at, coalesce(tf.desfecho_acao, tf.motivo), tf.aluno_id, pa.full_name, ps.full_name
  from public.tarefas tf
  left join public.alunos a on a.id = tf.aluno_id
  left join public.profiles pa on pa.user_id = a.user_id
  left join public.profiles ps on ps.user_id = tf.responsavel_id
  where tf.organization_id = _organization_id and tf.status = 'concluida'

  order by 2 desc
  limit 20;
end;
$function$;
