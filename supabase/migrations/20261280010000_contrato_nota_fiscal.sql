-- Contrato da Academia 2026-09-24: cláusula de responsabilidade fiscal.
--
-- A seção 3 passou a dizer o que o produto já faz desde a nota fiscal
-- automática: cada parte responde pelo fiscal do que entra no próprio caixa;
-- a nota de cada pagamento sai no CNPJ da academia, pela conta Asaas dela e
-- pelo valor que entrou no caixa dela; o cadastro fiscal é informado pela
-- academia e é dela, e a ArkeFit só o transmite ao Asaas. Versão nova, hash
-- novo, e a plataforma pede o aceite de novo ao gestor.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar —
-- aplicada antes, o banco trataria como vigente um texto que a página ainda
-- não mostra, e um aceite dado nesse intervalo ficaria gravado com o hash de
-- um texto que a pessoa não leu.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('contrato_academia', '2026-09-24', 'a74ce7dd53c6c10d24d01deb8a4f8d17933b2c731123082ab4ed01e0d9794f9e', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
