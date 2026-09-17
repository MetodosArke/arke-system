-- Remove tabelas legadas identificadas em investigação de código morto:
-- schema herdado do piloto arke-app (Arke-Supabase-Setup.sql) ou de
-- versões anteriores do motor de pontuação, sem nenhum uso por
-- server/*.ts nem dependência de outra tabela/policy/função ativa —
-- confirmado individualmente antes desta migração.
--
-- registro_treino/registro_serie: já chamadas de "tabela legada" em
-- comentários do código (arkeGamification.ts, arkeLembretes.ts) —
-- substituídas por treino_calendario.
-- equipamentos, metricas_customizadas, metrica_valores, dicas_semanais,
-- rotina_semanal, notificacao_preferencias, pontuacao_cache: só existem
-- no schema original do piloto, nunca ligadas a nenhuma função do
-- backend atual.
-- aluno_pagamento, pagamento_historico: controle financeiro real usa
-- asaas_payments — estas nunca são lidas/escritas por nenhuma função,
-- mesmo após a FK adicionada em 20260916_cadastro_direto_alunos_e_importacao.sql.
-- app_invitations, app_password_resets: substituídas por
-- member_invitations/saas_invitations e pelo mecanismo de recuperação
-- nativo do Supabase Auth, respectivamente.
--
-- NOTA: user_roles NÃO está nesta lista — embora nenhum server/*.ts a
-- consulte diretamente, a função public.has_role() (usada em dezenas de
-- policies RLS ativas, incluindo core_rls_policies.sql e
-- treino_dieta_versionamento.sql) consulta essa tabela. Dropá-la
-- quebraria has_role() e, por consequência, essas policies — fica de
-- fora desta limpeza.

drop table if exists public.registro_serie cascade;
drop table if exists public.registro_treino cascade;
drop table if exists public.equipamentos cascade;
drop table if exists public.metrica_valores cascade;
drop table if exists public.metricas_customizadas cascade;
drop table if exists public.dicas_semanais cascade;
drop table if exists public.rotina_semanal cascade;
drop table if exists public.notificacao_preferencias cascade;
drop table if exists public.pontuacao_cache cascade;
drop table if exists public.aluno_pagamento cascade;
drop table if exists public.pagamento_historico cascade;
drop table if exists public.app_invitations cascade;
drop table if exists public.app_password_resets cascade;
