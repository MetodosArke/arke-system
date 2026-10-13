-- Contrato da Academia, versão 2026-10-13 (PROPOSTA: só entra com a aprovação
-- do responsável). A ArkeFit não abre subcontas, e a cobrança da academia sai
-- da conta Asaas dela, pelo valor integral; o Método ARKE sai da conta da
-- ArkeFit, com a parte da academia por split (desenho confirmado pelo Asaas em
-- 13/10/2026). A seção 3 troca a retenção do repasse pelo item "Recebimentos",
-- menciona os Termos de Uso do Asaas e a responsabilidade fiscal passa a "a
-- ArkeFit, pelo que recebe".
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('contrato_academia', '2026-10-13', '8f3f2aa59a8856d741676d06d7c280cc3755b5f8a7f8270053ddcf3559359f62', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
