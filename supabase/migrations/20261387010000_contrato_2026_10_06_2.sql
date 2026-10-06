-- Contrato da Academia, versão 2026-10-06.2: a mesma cláusula de prestação
-- de serviços financeiros dos Termos, na seção 3 (cobrança dos alunos pela
-- plataforma). Cláusula modelo do playbook de BaaS do Asaas, aprovada pelo
-- responsável no workspace em 06/10/2026.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('contrato_academia', '2026-10-06.2', 'f01f9fdc896c954ab39d982bef003cf6c246b424fe06a8eb806c3dcf48dc833f', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
