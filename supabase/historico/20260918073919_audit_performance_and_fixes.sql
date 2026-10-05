-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Auditoria de Resiliência (Chaos & Load Testing) — correções de performance
-- e defesa em profundidade identificadas antes do lançamento comercial.

-- 1. Índice de baixa latência para o lookup de CPF nas catracas
create index if not exists idx_profiles_cpf on public.profiles(cpf);

-- 2. Índices de cobertura para foreign keys críticas
create index if not exists idx_alunos_user_id on public.alunos(user_id);
create index if not exists idx_tarefas_aluno_id on public.tarefas(aluno_id);
create index if not exists idx_treinos_modelo_id on public.treinos(modelo_id);

-- 3. Defesa em profundidade: revoga EXECUTE de anon nas RPCs de superadmin
-- (elas já checam has_role(auth.uid(), 'superadmin') internamente)
revoke execute on function public.get_superadmin_overview() from anon;
revoke execute on function public.get_superadmin_tenants() from anon;
