-- Novo modelo de venda: profissionais autônomos (Personal Trainer /
-- Nutricionista) que compram a plataforma para montar a própria carteira
-- de alunos, fora do modelo de academia/studio. Não substitui o modelo
-- B2B existente — é um novo tipo de organização/plano em paralelo.
--
-- ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação em que o
-- valor novo é referenciado, por isso fica isolado nesta migration.
alter type public.plano_b2b add value if not exists 'autonomo';
