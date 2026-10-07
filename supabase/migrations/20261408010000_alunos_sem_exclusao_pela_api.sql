-- O aluno só sai pela saída do aluno, e não pela API (frente D, 07/10/2026).
--
-- O que estava errado: a regra de exclusão de `alunos` (20261205010000) é
-- `is_org_staff` ou `admin_arke`. Pela API, a equipe inteira, a recepção
-- inclusive, apagava o aluno com um DELETE, e a cascata levava as conversas,
-- as tarefas, os treinos, as dietas, a anamnese e o resto sem passar pela
-- saída do aluno (`excluir-aluno` e `anonimizar-aluno`): o cliente no Asaas
-- ficava com o nome e o e-mail, os arquivos ficavam nos buckets, e nada ia
-- para a auditoria. Os gatilhos `before delete` seguravam a cobrança viva e
-- mandavam tirar a biometria, mas o resto da saída não rodava.
--
-- O que a tela faz hoje: nenhuma exclui o aluno direto. A lista de alunos
-- chama `excluir-aluno` (só academia em teste) e `anonimizar-aluno`, que
-- rodam com a service role e apagam pelo banco em `excluir_aluno_da_academia`
-- e `anonimizar_dados_do_aluno` (20261339010000), funções do dono das tabelas.
--
-- A escolha, no molde das conversas (20261406010000):
--   * a regra de exclusão sai (uma regra por operação: leitura, inclusão e
--     alteração ficam como estão);
--   * a permissão de excluir sai de `anon` e `authenticated`. Sem a regra, o
--     RLS já descartaria a exclusão, mas com resposta 200 e zero linhas; sem
--     a permissão, o pedido é recusado com 42501, e quem tentar sabe que não
--     apagou.
--
-- O que continua apagando: a saída do aluno e a limpeza da matrícula pública
-- não confirmada (`apagar_matriculas_publicas_nao_confirmadas`), que rodam
-- como dono das tabelas; a service role (as edge functions); e as exclusões
-- em cascata (a da academia, a da conta), que o Postgres faz como dono da
-- tabela e sem o RLS. O gatilho `trg_impedir_exclusao_com_cobranca_viva` e o
-- da biometria continuam valendo para todas.

set lock_timeout = '5s';

drop policy if exists "exclusão" on public.alunos;

revoke delete on public.alunos from anon, authenticated;
