-- Política de Privacidade 2026-09-30: o contato comercial além do site.
--
-- O Pipeline comercial (20261301010000) recebe contatos de WhatsApp,
-- telefone, indicação e prospecção. A Política passa a descrever esses canais:
-- quem procurou a ArkeFit segue em procedimentos preliminares a pedido
-- (art. 7º, V); indicação e prospecção entram por legítimo interesse
-- (art. 7º, IX), limitado ao contato profissional que a academia publicou, com
-- a origem dita no primeiro e-mail e o link para não receber mais em todos.
-- A Letícia responde sozinha só no site; nos outros canais, quando a equipe
-- aciona. Texto aprovado pelo responsável no chat em 30/09/2026.
-- Versão nova, hash novo: a plataforma pede o aceite de novo.
--
-- Com a Política publicada, liga o acionamento da Letícia nos outros canais
-- (`agente_comercial_outras_origens`), como a migration 20261301010000
-- previu. A Letícia continua desligada até alguém ligá-la no Pipeline
-- comercial, com o link da agenda.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-09-30', 'dc59c4d4f10f74dd11218f6372834c3c6cebd4fe9096a9b249efaec507ab7d69', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;

update public.plataforma_config set valor = 1, updated_at = now() where chave = 'agente_comercial_outras_origens';
