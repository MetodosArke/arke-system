-- Plano B2B "Redes": academias com até 3 unidades (decisão do responsável,
-- 01/10/2026). Fica num arquivo só porque o Postgres não deixa usar um valor
-- novo de enum na mesma transação que o criou; a tabela de preços e a regra
-- do limite entram na migration seguinte.

alter type public.plano_b2b add value if not exists 'redes' after 'enterprise';
