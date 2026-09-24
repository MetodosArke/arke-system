-- Política de Privacidade 2026-09-24: nota fiscal automática da academia.
--
-- A emissão da NFS-e no CNPJ da academia exige o endereço de quem recebe o
-- serviço, e a Política não dizia que o endereço era coletado. O texto novo
-- diz: o endereço entra no cadastro por causa da nota; a nota sai no CNPJ da
-- academia, pelo Asaas, e vai para a prefeitura da cidade dela; a BrasilAPI
-- recebe só o CEP do aluno; as notas emitidas ficam pelo prazo legal.
-- Versão nova, hash novo, e a plataforma pede o aceite de novo.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar —
-- aplicada antes, o banco trataria como vigente um texto que a página ainda
-- não mostra, e um aceite dado nesse intervalo ficaria gravado com o hash de
-- um texto que a pessoa não leu.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-09-24', '401ba8c2ce3e45133fa351a2d83cb4250586b70645b88ad1362bc1fccd2b55d2', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
