-- PÓS-DEPLOY. A dor e o esforço do fim do treino só com quem atende a saúde,
-- segunda parte (16/10/2026).
--
-- Rodar só depois do deploy do app que lê e grava no lugar novo, e da
-- conferência na Ponto Alto (a ordem está em docs/registro/seguranca-e-acesso.md). Antes
-- disso, o app publicado ainda lê `registro_treino.esforco_percebido`,
-- `registro_treino.sensacao` e `alunos.progressao_bloqueada_em`, e a tela
-- daria erro.
--
-- A `20261452010000` levou o esforço e a sensação para
-- `registro_treino_bem_estar` e a progressão suspensa para
-- `aluno_progressao_bloqueada`, e deixou um gatilho copiando o que o app antigo
-- ainda gravava em `registro_treino`. Aqui sai o que só servia à janela: o
-- gatilho da cópia e as colunas antigas. Com elas, a recepção deixa de ler a
-- dor e o esforço pela API.
--
-- `alunos.progressao_bloqueada_motivo` fica: vazia e sem ninguém que grave,
-- mas o Sentinela (congelado) a pede na consulta, e sem ela a sugestão do
-- mentor daria "Aluno não encontrado". Sai com a correção do Sentinela.

set lock_timeout = '5s';

drop trigger if exists trg_copiar_dor_e_esforco_da_janela on public.registro_treino;
drop function if exists public.copiar_dor_e_esforco_da_janela();

alter table public.registro_treino
  drop column if exists esforco_percebido,
  drop column if exists sensacao;

alter table public.alunos
  drop column if exists progressao_bloqueada_em;
