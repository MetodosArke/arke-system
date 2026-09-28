-- Contrato da Academia 2026-09-28.2: a cláusula 8 ganhou o parágrafo de que a
-- ArkeFit não garante resultado de retenção, evasão, receita ou adesão de
-- alunos, e de que os indicadores são medições do período, não promessa.
-- Texto aprovado pelo responsável em 28/09/2026 (comentário "Aprovado" no
-- próprio texto, no workspace, e no chat). Versão nova, hash novo: a
-- plataforma pede o aceite de novo aos gestores.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('contrato_academia', '2026-09-28.2', 'd4c10182699c4dd5c56996e7eb62ace0bd4cb8840aacd845bc48d132f03bbbfa', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
