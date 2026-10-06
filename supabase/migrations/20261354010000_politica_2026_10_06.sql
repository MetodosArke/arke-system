-- Política de Privacidade, versão de 06/10/2026 (decisão D2 do responsável).
--
-- Saída da auditoria de prontidão de 05/10: o assistente da equipe da
-- academia, que roda na infraestrutura global da AWS, entra na lista de
-- suboperadores e na transferência internacional; Google Fonts e YouTube
-- entram na lista; o resumo da anamnese no plano gratuito passa a constar da
-- seção 4; o Sentry identifica só por código interno; o hash de IP do contato
-- pelo site; e a seção 11 descreve o consentimento do responsável pelo menor,
-- que entrou no ar em 06/10. Texto aprovado pelo responsável no workspace em
-- 06/10/2026, como estava.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.
-- Versão nova, hash novo: a plataforma pede o aceite de novo a todos, o que
-- vale como o aviso que o Contrato promete às academias sobre suboperador novo.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-10-06', 'f0fba71e9b4cb201d3d51b5e664bc4b345346a6bd39aeeae05f4ba14724817ff', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
