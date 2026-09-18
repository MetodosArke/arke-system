-- Auditoria de Resiliência (Chaos & Load Testing) — correções de performance
-- e defesa em profundidade identificadas antes do lançamento comercial.

-- -----------------------------------------------------------------
-- 1. Índice de baixa latência para o lookup de CPF nas catracas
--    (catraca-validar-acesso consulta profiles por cpf a cada leitura,
--    sem índice isso degrada para seq scan conforme a base cresce).
-- -----------------------------------------------------------------
create index if not exists idx_profiles_cpf on public.profiles(cpf);

-- -----------------------------------------------------------------
-- 2. Índices de cobertura para foreign keys críticas (apontadas pelo
--    advisor de performance do Supabase como sem índice).
-- -----------------------------------------------------------------
create index if not exists idx_alunos_user_id on public.alunos(user_id);
create index if not exists idx_tarefas_aluno_id on public.tarefas(aluno_id);
create index if not exists idx_treinos_modelo_id on public.treinos(modelo_id);

-- -----------------------------------------------------------------
-- 3. Defesa em profundidade: as RPCs de superadmin já checam
--    has_role(auth.uid(), 'superadmin') internamente e lançam exceção
--    caso contrário — mas o Postgres concede EXECUTE a PUBLIC por
--    padrão na criação de uma função, e todo papel (inclusive anon)
--    herda de PUBLIC. Por isso revogamos de PUBLIC (não só de anon)
--    e regravamos o grant explícito para authenticated, que é quem
--    de fato deve poder chamar essas RPCs (mesmo sem role de
--    superadmin, a função checa isso internamente e nega o acesso).
-- -----------------------------------------------------------------
revoke execute on function public.get_superadmin_overview() from public;
revoke execute on function public.get_superadmin_tenants() from public;
grant execute on function public.get_superadmin_overview() to authenticated;
grant execute on function public.get_superadmin_tenants() to authenticated;
