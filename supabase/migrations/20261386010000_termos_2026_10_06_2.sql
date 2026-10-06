-- Termos de Uso, versão 2026-10-06.2: a cláusula de prestação de serviços
-- financeiros do Asaas.
--
-- A homologação do BaaS do Asaas (Resolução Conjunta BCB/CMN nº 16/2025, art.
-- 14) pede que o Asaas apareça como o prestador dos serviços financeiros
-- também nos termos e contratos. A seção 5 ganhou a cláusula modelo do
-- playbook do Asaas: o Asaas presta os serviços financeiros e de pagamento,
-- a ArkeFit só integra a tecnologia e não é instituição financeira nem de
-- pagamento, e o suporte sobre as operações financeiras é do Asaas. Texto
-- aprovado pelo responsável no workspace em 06/10/2026.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('termos_uso', '2026-10-06.2', '69076e2b5668289147efb9faaef3adbcea7f12dfc15d55e4e6a97e5138be011d', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
