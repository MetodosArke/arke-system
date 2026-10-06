-- Política de Privacidade, versão 2026-10-06.2: o memorando do advogado.
--
-- O responsável enviou em 06/10/2026 o memorando de adequação regulatória do
-- advogado, com duas redações para a Política:
-- - seção 6: a transferência internacional fundamentada no art. 33, II, com os
--   DPAs dos provedores em conformidade com as Cláusulas-Padrão da ANPD
--   (Resolução CD/ANPD 19/2024);
-- - seção 7: a guarda dos registros de acesso por 6 meses (Marco Civil,
--   art. 15), apagados depois, inexistindo ordem judicial em contrário
--   (migrations 20261380 e 20261381).
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-10-06.2', '82fa9b246d294daa2cffacc20510b8c0292dcbd66b02804dd3042e0a466cd550', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
