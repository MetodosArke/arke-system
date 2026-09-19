-- Feed de atividade auditável para o perfil de organização no SuperAdmin
-- (mesmo tratamento dado ao perfil de funcionário, PR #113): treinos e
-- dietas publicados, avaliações físicas registradas e pendências
-- resolvidas na organização, com o aluno e o responsável de cada uma —
-- não é possível ler essas tabelas diretamente do client como superadmin
-- (RLS só libera staff da própria organização ou admin_arke), por isso é
-- uma RPC SECURITY DEFINER com a própria checagem de papel, no mesmo
-- padrão de get_superadmin_tenants().
create or replace function public.get_superadmin_organizacao_atividade(_organization_id uuid)
returns table (
  tipo               text,
  data               timestamptz,
  descricao          text,
  aluno_id           uuid,
  aluno_nome         text,
  responsavel_nome   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
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

  order by data desc
  limit 20;
end;
$$;

revoke all on function public.get_superadmin_organizacao_atividade(uuid) from public;
grant execute on function public.get_superadmin_organizacao_atividade(uuid) to authenticated;
