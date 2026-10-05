-- Versão mínima do Gateway para 1.8.1 (05/10/2026).
--
-- Até a 1.8.0, o espelho da Intelbras gravava UserType 5 no aluno barrado:
-- o 5 é usuário de acessibilidade, e o bloqueado é o 1 (resposta da
-- Intelbras). Com a mínima em 1.8.1, a Visão Master marca qualquer Gateway
-- com o espelho antigo. Só muda se ninguém tiver mexido no valor.
set lock_timeout = '5s';

update public.plataforma_textos
   set valor = '1.8.1', updated_at = now()
 where chave = 'gateway_versao_minima'
   and valor = '1.7.0';
