-- Selamento e Expansão Comercial — completa a árvore de perguntas da
-- anamnese M.A.P.A.® (rotina de sono, nível de estresse e frequência
-- semanal desejada) e adiciona o registro de consentimento LGPD para
-- tratamento de dados de saúde no primeiro acesso do aluno.
alter table public.anamnese_acolhimento
  add column if not exists qualidade_sono text,
  add column if not exists nivel_estresse text,
  add column if not exists frequencia_semanal_desejada integer,
  add column if not exists consentimento_lgpd_aceito_em timestamptz;

comment on column public.anamnese_acolhimento.consentimento_lgpd_aceito_em is
  'Data/hora em que o aluno aceitou o termo de consentimento para tratamento de dados de saúde (LGPD), no onboarding M.A.P.A.®. Nulo = ainda não aceitou.';
