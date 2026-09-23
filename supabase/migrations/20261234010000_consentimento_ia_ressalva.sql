-- Ressalva sobre texto livre no consentimento de IA — parecer de 23/09/2026,
-- item 3.5.
--
-- O sistema remove os campos estruturados (nome, CPF, e-mail, telefone) antes
-- de enviar, mas **não mascara dado pessoal digitado no meio da conversa** —
-- fazer isso destruiria o sentido do que se quer analisar. O parecer concluiu
-- que a ressalva é suficiente desde que apareça **em destaque no próprio
-- opt-in**, e não apenas na Política de Privacidade: é o aviso claro que afasta
-- a alegação de indução a erro.
--
-- Como o texto consentido mudou, a versão muda junto, pela mesma regra dos
-- documentos legais: quem tivesse consentido sob o texto anterior seria
-- perguntado de novo. (Hoje não há nenhum consentimento gravado, então o
-- efeito prático é nenhum — a regra vale de qualquer forma.)

create or replace function public.versao_consentimento_ia()
returns text
language sql
immutable
as $$ select '2026-09-23.2'::text $$;

alter table public.aluno_consentimento_ia
  alter column retencao_descricao set default
    'O processamento é feito por provedor de inteligência artificial com servidores fora do Brasil. '
    'O provedor pode guardar o conteúdo por até 30 dias para checagem de uso indevido, e não o utiliza '
    'para treinar modelos. Não são enviados nome, CPF, e-mail nem telefone; as mensagens escritas pelo '
    'aluno, porém, são enviadas como ele as escreveu, inclusive qualquer dado pessoal digitado nelas. '
    'O que o ARKE guarda fica enquanto durar a matrícula e é apagado se a autorização for retirada.';

alter table public.aluno_consentimento_ia
  alter column versao_texto set default '2026-09-23.2';
