-- Versão mínima do Gateway Local (Rodada B, 05/10/2026).
--
-- A Visão Master mostra a catraca cujo Gateway está abaixo dela, e o canal de
-- comandos devolve o valor ao Gateway, que avisa no log. Nada é bloqueado:
-- parar a catraca de uma academia por versão seria pior que a versão velha.
-- Começa em 1.7.0, a versão em que o token passou a ser guardado só como hash
-- e o receptor passou a atender só os equipamentos da academia.
set lock_timeout = '5s';

insert into public.plataforma_textos (chave, valor, descricao) values
  ('gateway_versao_minima', '1.7.0',
   'Versão mínima do Gateway Local (ex.: 1.7.0). Abaixo dela, a Visão Master marca a catraca e o Gateway avisa no log. Vazio: sem mínima.')
on conflict (chave) do nothing;

alter table public.plataforma_textos
  add constraint plataforma_textos_gateway_versao_minima_formato
  check (chave <> 'gateway_versao_minima' or valor is null or valor ~ '^[0-9]+\.[0-9]+\.[0-9]+$');
