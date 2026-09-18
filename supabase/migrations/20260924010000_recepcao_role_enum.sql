-- Gestão de Equipe: adiciona "Recepção" como papel real de staff, ao lado
-- de Gestor/Personal/Nutricionista, para o modal de edição de membros.
--
-- ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação em que o
-- valor novo é referenciado, por isso fica isolado nesta migration.
alter type public.app_role add value if not exists 'recepcao';
