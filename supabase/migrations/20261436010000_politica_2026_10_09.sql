-- Política de Privacidade, versão 2026-10-09: o assistente pela API da
-- Anthropic.
--
-- O assistente que responde dúvidas da equipe da academia passa a rodar pela
-- API da Anthropic, nos Estados Unidos, com a AWS (infraestrutura global) de
-- reserva (#368). O texto antigo dizia só AWS. Texto aprovado pelo
-- responsável no workspace em 09/10/2026 (politica-anthropic-assistente):
-- - seção 5: a Anthropic entra na lista de suboperadores, com o que ela faz
--   com o conteúdo (não treina modelos; apaga em até 30 dias, salvo violação
--   das regras de uso ou obrigação legal);
-- - seção 6: o assistente é processado fora do Brasil, pela Anthropic ou pela
--   infraestrutura global da AWS, sem a identificação dos alunos;
-- - seção 4: nas finalidades dela (Brasil, Bedrock em São Paulo), a Anthropic
--   não recebe o que o aluno escreveu.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-10-09', '0c12c29a9cefee7818f324fbeb395d9c192fad42779aa359246dcf016afa4d46', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
