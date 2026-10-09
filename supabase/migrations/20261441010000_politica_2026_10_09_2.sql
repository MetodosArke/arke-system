-- Política de Privacidade, versão 2026-10-09.2: os e-mails do serviço.
--
-- O Resend (envio de e-mail) respondeu em 09/10/2026 que não assina nem
-- anexa as cláusulas-padrão da ANPD (Resolução CD/ANPD 19/2024). A seção 6
-- passa a dizer que o nome e o e-mail dos e-mails transacionais e das
-- notificações operacionais (senha, acesso, cobrança) podem ser processados
-- por provedores fora do Brasil, como o Resend, nos Estados Unidos, com base
-- no art. 33, IX, da LGPD (execução do contrato), e a frase das cláusulas da
-- ANPD passa a valer "nos demais casos". Texto trazido pelo responsável em
-- 09/10/2026.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-10-09.2', '223eb6f4d3f9a766747b944573f59e688f8034378bb4b54f76d430dc881cfab4', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
