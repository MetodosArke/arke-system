-- Contrato da Academia, versão 2026-10-06: o teto do Growth na tabela da
-- seção 2 (até 500 alunos; o Enterprise a partir de 501). Nada mais muda no
-- texto. Versão nova, hash novo: a plataforma pede o aceite de novo ao gestor.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('contrato_academia', '2026-10-06', 'bd656f0f0c60c9b61bbbbfefa781235a870d402e3d06daaef63f84cd322f7844', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
