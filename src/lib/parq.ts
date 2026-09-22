/**
 * PAR-Q (Physical Activity Readiness Questionnaire), nas 7 perguntas do PAR-Q+.
 * Qualquer "sim" pede atestado médico antes de treinar. Em São Paulo, a Lei
 * 16.724/2018 aceita o PAR-Q sem nenhum "sim" no lugar do atestado.
 */

export const PERGUNTAS_PARQ = [
  "Algum médico já disse que você tem problema de coração ou pressão alta?",
  "Você sente dor no peito em repouso, nas atividades do dia a dia ou quando faz atividade física?",
  "Você perde o equilíbrio por tontura, ou perdeu a consciência nos últimos 12 meses? (Responda não se a tontura foi só por respiração acelerada durante exercício intenso.)",
  "Você já foi diagnosticado com alguma outra doença crônica, além de problema de coração ou pressão alta?",
  "Você toma remédio receitado para alguma doença crônica?",
  "Você tem (ou teve nos últimos 12 meses) problema nos ossos, articulações, músculos, ligamentos ou tendões que possa piorar com atividade física?",
  "Algum médico já disse que você só deve fazer atividade física com supervisão médica?",
] as const;

export type SituacaoAtestado = "nao_precisa" | "falta" | "vencido" | "vence_logo" | "valido";

/** Situação do atestado a partir do PAR-Q; `hoje` injetável para teste. */
export function situacaoAtestado(
  parq: { algum_sim: boolean | null; atestado_validade: string | null } | null,
  hoje = new Date()
): SituacaoAtestado {
  if (!parq || !parq.algum_sim) return "nao_precisa";
  if (!parq.atestado_validade) return "falta";
  const dia = hoje.toISOString().slice(0, 10);
  if (parq.atestado_validade < dia) return "vencido";
  const limite = new Date(hoje.getTime() + 15 * 86_400_000).toISOString().slice(0, 10);
  return parq.atestado_validade < limite ? "vence_logo" : "valido";
}

export const ROTULO_ATESTADO: Record<SituacaoAtestado, string> = {
  nao_precisa: "Não precisa (PAR-Q sem \"sim\")",
  falta: "Falta o atestado",
  vencido: "Atestado vencido",
  vence_logo: "Atestado vence em breve",
  valido: "Atestado válido",
};

/**
 * Modelo de contrato de matrícula, ponto de partida para a academia ajustar.
 * Não é aconselhamento jurídico: a academia deve revisar com o advogado dela.
 */
export function modeloContratoMatricula(academia: string): string {
  return `# Contrato de matrícula — ${academia}

## 1. Partes
De um lado, ${academia} ("Academia"); de outro, o aluno identificado no cadastro do aplicativo ("Aluno").

## 2. Objeto
Prestação de serviços de atividade física orientada, nas modalidades e horários do plano contratado pelo Aluno.

## 3. Plano, pagamento e reajuste
- O plano, o valor e a forma de pagamento são os escolhidos na matrícula.
- O atraso no pagamento pode suspender o acesso até a regularização.
- Os valores podem ser reajustados uma vez por ano, com aviso prévio de 30 dias.

## 4. Saúde e segurança
- O Aluno declara ter respondido com verdade o questionário de prontidão (PAR-Q) e se compromete a apresentar atestado médico sempre que alguma resposta indicar essa necessidade.
- O Aluno deve informar à equipe qualquer dor, lesão ou mudança no seu estado de saúde, e seguir as orientações dos profissionais da Academia.

## 5. Regras de uso
O Aluno segue o regulamento interno da Academia, zela pelos equipamentos e respeita os demais alunos e a equipe.

## 6. Pausa e cancelamento
- A matrícula pode ser pausada nas condições previstas no plano (viagem, saúde, entre outras).
- O cancelamento pode ser pedido a qualquer momento, observadas as condições do plano contratado.

## 7. Dados pessoais
Os dados do Aluno são tratados conforme a Política de Privacidade da plataforma e a legislação de proteção de dados.

## 8. Assinatura
Este contrato é assinado eletronicamente pelo Aluno no aplicativo, com registro de data, hora e do texto assinado (Lei 14.063/2020).`;
}
