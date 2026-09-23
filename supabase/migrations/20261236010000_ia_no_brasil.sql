-- A IA do Sentinela passa a rodar no Brasil (23/09/2026).
--
-- A análise da anamnese e o rascunho de resposta do Mentor saem da OpenAI
-- (servidores nos EUA) e vão para o Amazon Bedrock em São Paulo (sa-east-1).
-- Com isso a análise **deixa de envolver transferência internacional**.
--
-- **Por que só o Claude 3 Haiku.** Em sa-east-1, na data, os modelos modernos
-- da Anthropic só eram invocáveis por perfil de inferência `global.*`, que
-- roteia para qualquer região comercial da AWS no mundo. Apenas Claude 3 Haiku
-- e Claude 3 Sonnet aceitavam invocação direta na região. A escolha foi pelo
-- lugar do processamento, que é o que o termo promete ao aluno; a qualidade
-- foi conferida nas duas tarefas reais antes de trocar.
--
-- **A garantia mora no código, não nesta migration.** `_shared/ia.ts` fixa a
-- região e recusa modelo com prefixo de roteamento antes de enviar qualquer
-- byte. Esta migration só torna os textos verdadeiros.
--
-- Os textos mudaram a favor do titular (menos risco, nenhuma finalidade nova),
-- mas mudaram: versão nova, hash novo, aceite novo — a regra de sempre.

create or replace function public.versao_consentimento_ia()
returns text
language sql
immutable
as $$ select '2026-09-23.3'::text $$;

alter table public.aluno_consentimento_ia
  alter column versao_texto set default '2026-09-23.3',
  alter column retencao_descricao set default
    'O processamento é feito no Brasil, em servidores da Amazon Web Services em São Paulo. '
    'O provedor não guarda o conteúdo e não o utiliza para treinar modelos. Não são enviados nome, '
    'CPF, e-mail nem telefone; as mensagens escritas pelo aluno, porém, são enviadas como ele as '
    'escreveu, inclusive qualquer dado pessoal digitado nelas. O que o ARKE guarda fica enquanto '
    'durar a matrícula e é apagado se a autorização for retirada.';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values
  ('privacidade', '2026-09-23.3', 'd3f885fd47f43bf85b30046d702bc20c1dc2578fd0a1a4ac604e9a1369fa4681', now()),
  ('contrato_academia', '2026-09-23.3', '746a33c5a71f61253579ad5d6101de95fcc4d8efed28a603bcc83781d30a909d', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
