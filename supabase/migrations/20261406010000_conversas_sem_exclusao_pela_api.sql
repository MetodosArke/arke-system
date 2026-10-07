-- Nenhuma mensagem dos chats se apaga pela API (sobras da frente B,
-- 07/10/2026).
--
-- O que estava errado: o chat de treino e o de nutrição da academia têm uma
-- regra de exclusão igual à de leitura (20261400010000): quem lê a conversa
-- apaga qualquer mensagem dela. Pela API, a recepção e o professor apagavam a
-- mensagem que o aluno mandou ("tenho dor no joelho"), e a nutricionista a
-- conversa de nutrição inteira; do outro lado, o aluno apagava a orientação
-- que o professor deu. Nenhuma tela exclui mensagem: o chat do painel, o da
-- ficha e o do app só incluem e marcam como lida.
--
-- A escolha: ninguém apaga mensagem pela API, nem a do outro lado nem a
-- própria. É a regra que o canal do Mentor já tem desde que nasceu
-- (20261219010000, "conversa de acompanhamento é registro"), e é o que a tela
-- usa hoje: deixar a equipe apagar a própria mensagem seria abrir uma
-- operação que nenhuma tela pede, e a orientação dada ao aluno some do
-- registro do atendimento.
--   * a regra de exclusão sai dos dois chats (uma regra por operação: a
--     leitura, a inclusão e a alteração ficam como estão);
--   * a permissão de excluir sai de `anon` e `authenticated` nos três chats.
--     Sem a regra, o RLS já descartaria a exclusão, mas com resposta 200 e
--     zero linhas; sem a permissão, o pedido é recusado com 42501, e quem
--     tentar sabe que não apagou.
--
-- O que continua apagando: a saída do aluno (`anonimizar_dados_do_aluno` e
-- `excluir_aluno_da_academia`, 20261339010000), que roda no servidor com a
-- permissão do dono das tabelas, e as exclusões em cascata (a do aluno, a da
-- academia, a da dieta), que o Postgres faz como dono da tabela e sem o RLS.

set lock_timeout = '5s';

drop policy if exists "exclusão" on public.mensagens_treino;
drop policy if exists "exclusão" on public.mensagens_dieta;

revoke delete on public.mensagens_treino, public.mensagens_dieta, public.mensagens_mentor from anon, authenticated;
