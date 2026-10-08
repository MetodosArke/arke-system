-- A service role usa a sequência de toda coluna que se numera sozinha
-- (frente D, 07/10/2026).
--
-- A regra (CLAUDE.md, `20261201020000`): a service role pula o RLS, mas não a
-- permissão, e os privilégios padrão do projeto cobrem tabela, não sequência.
-- Em coluna `bigserial` sem o `grant usage`, o insert da edge function leva
-- 403 (a reconciliação do Asaas gravava nada e respondia 200). As cinco
-- tabelas com `bigserial` têm o grant.
--
-- A auditoria de prontidão apontou as três do Vigia sem ele. Elas numeram por
-- `generated always as identity`, e o Postgres não confere a permissão da
-- sequência de uma coluna identity: o insert da service role funciona sem o
-- grant (a prova local confere). O grant entra mesmo assim, para a regra ser
-- uma só, sem exceção por tipo de coluna: toda sequência de coluna que se
-- numera sozinha tem o uso para a service role (`sequencias.guarda`). Só a
-- service role: ninguém insere nessas tabelas pela API.

set lock_timeout = '5s';

grant usage on sequence public.vigia_ocorrencias_id_seq, public.vigia_analises_id_seq, public.vigia_acoes_id_seq to service_role;
