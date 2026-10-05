-- Aplicada DEPOIS do deploy da tela e das funções da catraca: a versão
-- anterior da tela lia `device_token`.
set lock_timeout = '5s';

-- O token em claro sai de vez. Desde `20261325010000_token_catraca_hash.sql`
-- a coluna estava vazia, e o Gateway é conferido pelo hash.
alter table public.organizacao_catracas drop column if exists device_token;
