-- Fecha a validação de CPF: constraint validada retroativamente e unicidade.
--
-- A migração anterior criou a checagem como NOT VALID porque a base tinha
-- 8 CPFs inválidos (sequências do tipo 123.456.789-01, entradas pela
-- importação que não validava nada) e 1 CPF repetido em duas pessoas
-- diferentes. Derrubar a migração por causa de dado legado teria travado o
-- deploy; deixar NOT VALID para sempre teria deixado a garantia pela metade.
--
-- Com os CPFs de homologação removidos (registrado em
-- auditoria_acoes_sensiveis como `limpeza_cpfs_invalidos`), as duas peças
-- que faltavam passam a ser possíveis.

-- 1) A checagem deixa de ser só para linhas novas.
alter table public.profiles validate constraint profiles_cpf_valido;

-- 2) Uma pessoa, um CPF.
--
-- `profiles` é por usuário da plataforma, então CPF repetido significa ou
-- cadastro duplicado da mesma pessoa, ou erro de digitação apontando para
-- alguém que não é. Os dois casos são ruins e silenciosos: o duplicado
-- divide o histórico do aluno em dois, e o errado dá acesso de catraca à
-- pessoa errada.
--
-- Índice parcial porque CPF não é obrigatório — aluno sem documento
-- cadastrado continua válido, e vários nulos não colidem entre si.
create unique index if not exists idx_profiles_cpf_unico
  on public.profiles (cpf)
  where cpf is not null and cpf <> '';

comment on index public.idx_profiles_cpf_unico is
  'Uma pessoa, um CPF. Parcial: quem não tem CPF cadastrado não colide.';
