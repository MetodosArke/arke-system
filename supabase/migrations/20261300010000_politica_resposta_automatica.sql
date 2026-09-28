-- Política de Privacidade 2026-09-28.2: a resposta automática ao contato do
-- site (Letícia). O texto é nosso, e a inteligência artificial, no Brasil,
-- escreve uma ou duas frases a partir da mensagem enviada; só a mensagem, a
-- faixa de alunos e o sistema atual vão ao modelo. Texto aprovado pelo
-- responsável no workspace em 28/09/2026, como estava. Versão nova, hash
-- novo: a plataforma pede o aceite de novo.
--
-- Com a Política publicada, liga a frase da IA da Letícia
-- (`agente_comercial_ia`), como a migration 20261298010000 previu. A Letícia
-- continua desligada até alguém ligá-la em Visão Master → Contatos do site.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-09-28.2', '7324b3cf3cd60d70fcb4c9fc55d6a6ffd23ef50f8f91045a0dbf09e562a35be6', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;

update public.plataforma_config set valor = 1, updated_at = now() where chave = 'agente_comercial_ia';
