-- Módulo de Gestão de Studios e Turmas Fechadas: "studio" passa a ser um
-- terceiro valor de organizations.tipo (além de "academia" e
-- "profissional_autonomo"), com turmas de horário fixo e capacidade
-- limitada — diferente de uma academia tradicional (livre acesso) e de
-- um profissional autônomo (carteira individual sem turmas).
--
-- ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação em que o
-- valor novo é referenciado, por isso fica isolado nesta migration.
alter type public.organization_tipo add value if not exists 'studio';
