-- Contrato da Academia 2026-10-01: a tabela B2B nova na seção 2.
--
-- Growth R$ 390 (uma unidade, até 300 alunos), Enterprise R$ 790 (a partir
-- de 301), Redes R$ 1.290 (até 3 unidades, cobrado na unidade principal) e
-- Custom sob consulta, para redes com mais de 3 unidades. Os preços e limites
-- no banco mudaram em 20261305010000. Versão nova, hash novo: a plataforma
-- pede o aceite de novo ao gestor.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('contrato_academia', '2026-10-01', '34813d2be0830ea0b2cd8f062bd3acb7b3e5021d7fdfba0a38908899b4399b68', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
