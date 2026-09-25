-- Política de Privacidade 2026-09-25: a leitura do plano alimentar em PDF
-- volta, processada no Brasil, e o contato pelo site entra na Política.
--
-- A importação de dieta por PDF saiu em 24/09/2026 porque mandava o arquivo
-- ao Google, fora do Brasil e fora da Política. Volta assim: o navegador
-- extrai o texto (o arquivo não sai do aparelho), a plataforma tira as linhas
-- de identificação que reconhece, e o Amazon Bedrock em São Paulo só
-- transcreve as refeições, que a nutricionista revisa. O texto diz isso, diz
-- que não é análise sobre o aluno e dá a base legal (a mesma do
-- acompanhamento). E o formulário da página de vendas passa a constar, com a
-- guarda de 12 meses sem andamento para quem não virou cliente.
-- Versão nova, hash novo, e a plataforma pede o aceite de novo.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-09-25', 'f792770937cec9018e51bb60a0c22454e8d1e047e5da53903e3614b1df9d5b66', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
