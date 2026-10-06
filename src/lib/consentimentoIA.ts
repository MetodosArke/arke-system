/**
 * O texto do consentimento de IA — dos dois interruptores do aluno (Perfil →
 * Privacidade) e da página em que o responsável do aluno menor autoriza.
 *
 * Saiu de `SentinelaAnamnese.tsx` sem mudar uma palavra (06/10/2026): a página
 * do responsável mostra exatamente o que o aluno lê no app, e o hash do texto
 * que ela grava (`_shared/textosResponsavel.ts`) é conferido contra este
 * arquivo por `textosConsentimento.test.ts`. Texto mudou de sentido, muda a
 * versão aqui e em `public.versao_consentimento_ia()`.
 */

/** Espelho de `public.versao_consentimento_ia()`. Mudou lá, muda aqui. */
export const VERSAO_CONSENTIMENTO_IA = "2026-09-23.4";

export type PropositoIA = "anamnese" | "chat";

export const PROPOSITOS_IA: { chave: PropositoIA; titulo: string; texto: string }[] = [
  {
    chave: "anamnese",
    titulo: "Resumo da minha anamnese para a equipe",
    texto:
      "Autorizo que a inteligência artificial do ARKE leia a minha anamnese para resumir, à equipe que me " +
      "acompanha, o histórico que exige cuidado no treino.",
  },
  {
    chave: "chat",
    titulo: "Apoio à resposta do meu mentor",
    texto:
      "Autorizo que a inteligência artificial do ARKE leia as minhas últimas mensagens com o mentor para " +
      "sugerir a ele um rascunho de resposta. Quem escreve e envia continua sendo o mentor.",
  },
];

/**
 * Onde o dado é processado, dito junto do interruptor e não só na Política,
 * porque é a informação que mais pesa para quem decide. Em trechos, para a tela
 * manter o destaque em negrito que o parecer jurídico pediu (item 3.5) e o hash
 * ler o mesmo texto corrido.
 */
export const AVISO_PROCESSAMENTO_IA: { texto: string; destaque?: boolean }[] = [
  { texto: "O processamento é feito " },
  { texto: "no Brasil", destaque: true },
  {
    texto:
      ", em servidores da Amazon Web Services em São Paulo. O conteúdo não fica registrado na nossa conta do " +
      "provedor, e não é utilizado para treinar modelos. Não enviamos o seu nome, CPF, e-mail nem telefone — mas ",
  },
  {
    texto:
      "as mensagens que você escreveu são enviadas como você as escreveu, inclusive qualquer dado pessoal que você " +
      "tenha digitado nelas",
    destaque: true,
  },
  { texto: ". O que o ARKE guarda fica enquanto durar a sua matrícula. " },
  { texto: "Você pode retirar qualquer destas autorizações quando quiser", destaque: true },
  { texto: ", e o que tiver sido gerado a partir do dado é apagado." },
];

export const AVISO_PROCESSAMENTO_IA_TEXTO = AVISO_PROCESSAMENTO_IA.map((t) => t.texto).join("");
