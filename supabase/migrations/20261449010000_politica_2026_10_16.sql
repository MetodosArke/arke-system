-- Política de Privacidade, versão 2026-10-16: a pesquisa de mercado e a
-- tentativa de entrar que falha.
--
-- A seção 2 ganha a pesquisa de mercado da ArkeFit (respostas anônimas; o
-- e-mail opcional, à parte e só com autorização) e, nos dados técnicos, o
-- registro da tentativa de entrar que falha (a conta por código interno ou o
-- e-mail cifrado, e o IP cifrado). A seção 3 dá a finalidade e a base de cada
-- um, e a seção 7 os prazos: 12 meses para o e-mail da pesquisa e 6 meses
-- para as tentativas. Decisão do responsável no workspace em 16/10/2026.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar, e
-- antes de a pesquisa de mercado (PR #403) ir ao ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-10-16', '8b6a18a1ddf1c6179fb3822617c70d73c59e3521fd695fa01cbe34b08b102ae4', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
