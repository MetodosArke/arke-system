-- Política de Privacidade, versão 2026-10-10: sono e energia.
--
-- O aluno passa a marcar no fim do treino como dormiu e a energia do dia
-- (20261442010000). A seção 2 acrescenta esses dois à lista de dados de saúde.
-- Decisão do responsável em 10/10/2026.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-10-10', '34f4a1020177d1d822f0b07ecc10ce3064b400c7524a1c831db4fe030e884954', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
