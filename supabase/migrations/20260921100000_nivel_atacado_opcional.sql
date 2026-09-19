-- O aluno importado/cadastrado ainda não foi apresentado ao Método ARKE
-- — ele só entra pós-implantação, como negociação à parte. Até então não
-- faz sentido o aluno já "ter" um nível do método (essencial por
-- default, como estava antes). nivel_atacado passa a ser opcional
-- (NULL = sem método nenhum ainda) e só é preenchido de verdade quando o
-- staff registra a adesão (ou quando o próprio aluno assina via
-- matrícula pública, que já escolhe o nível na hora).
alter table public.alunos
  alter column nivel_atacado drop not null,
  alter column nivel_atacado drop default;
