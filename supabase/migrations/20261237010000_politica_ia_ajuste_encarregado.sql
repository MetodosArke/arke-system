-- Política de Privacidade 2026-09-23.4 e consentimento de IA 2026-09-23.4.
--
-- O encarregado de dados aprovou a versão .3 com um ajuste de redação: a
-- frase "o provedor não guarda o seu conteúdo" passa a ser "o conteúdo não
-- fica registrado na nossa conta do provedor". A primeira se apoiava na
-- documentação de proteção de dados da AWS; a segunda diz só o que foi de
-- fato verificado — o registro de invocações do Bedrock na conta está
-- desligado. Um texto jurídico deve afirmar o que se consegue provar.
--
-- O Contrato da Academia não contém a frase e fica em 2026-09-23.3, aprovado
-- sem alteração.
--
-- **Ordem de aplicação:** esta migration entra DEPOIS de o deploy com o texto
-- .4 estar no ar, e não antes. Aplicada antes, o banco trataria como vigente
-- um texto que a página ainda não mostra, e um aceite dado nesse intervalo
-- ficaria gravado com o hash de um texto que a pessoa não leu.

create or replace function public.versao_consentimento_ia()
returns text
language sql
immutable
as $$ select '2026-09-23.4'::text $$;

alter table public.aluno_consentimento_ia
  alter column versao_texto set default '2026-09-23.4',
  alter column retencao_descricao set default
    'O processamento é feito no Brasil, em servidores da Amazon Web Services em São Paulo. '
    'O conteúdo não fica registrado na nossa conta do provedor, e não é utilizado para treinar '
    'modelos. Não são enviados nome, CPF, e-mail nem telefone; as mensagens escritas pelo aluno, '
    'porém, são enviadas como ele as escreveu, inclusive qualquer dado pessoal digitado nelas. '
    'O que o ARKE guarda fica enquanto durar a matrícula e é apagado se a autorização for retirada.';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-09-23.4', 'b854df771e88e3b0441a073a2a4e0a722d9ba9354ea829b7973b7442f3102423', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
