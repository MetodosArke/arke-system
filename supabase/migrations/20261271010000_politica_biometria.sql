-- Política de Privacidade 2026-09-23.5: a digital, como ela funciona na
-- versão 1.0 (decisão do responsável, 23/09/2026).
--
-- A versão .4 dizia que o consentimento era "registrado à parte" e que "a
-- revogação apaga o vínculo da digital". A 1.0 faz mais, e o texto passou a
-- dizer o que acontece de fato: a autorização é dada no app ou pelo termo
-- impresso assinado; retirar a autorização, encerrar a matrícula ou eliminar
-- os dados apaga a digital dos equipamentos da Academia; e o termo assinado
-- fica guardado pelo prazo legal, como prova. Versão nova, hash novo, e a
-- plataforma pede o aceite de novo.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto .5 estar no ar —
-- aplicada antes, o banco trataria como vigente um texto que a página ainda
-- não mostra, e um aceite dado nesse intervalo ficaria gravado com o hash de
-- um texto que a pessoa não leu.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-09-23.5', '8086c5b2ff61d59794b5a7fbebe5f3f8cf0b24aa8fb65d24ab82883b618b803d', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
