-- Remove a tabela app_students (item "Alunos"/"App do aluno" do menu),
-- identificada como código morto ao construir o cadastro direto de alunos
-- desta mesma leva (ver 20260916_cadastro_direto_alunos_e_importacao.sql):
-- CRUD solto sem organization_id/RLS por organização, restrito ao Super
-- Admin (admin.students, agora removido de server/routers.ts), sem
-- nenhuma relação real com saas_organizations/profiles/alunos. 0 linhas em
-- produção, nenhuma FK aponta para ela — remoção segura.

drop table if exists public.app_students;
