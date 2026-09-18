-- Etapa 6, Stage 3: Painel Super Admin (Visão Master ArkeFit)
-- Adiciona o papel 'superadmin' ao enum app_role. Precisa ser sua própria
-- migration/transação: o Postgres não permite usar um valor de enum recém
-- adicionado (em função, policy etc.) na mesma transação em que foi criado.
alter type public.app_role add value 'superadmin';
