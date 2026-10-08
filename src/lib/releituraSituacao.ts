/**
 * Quando o app do aluno relê a situação dele na academia (em dia, pausado,
 * inadimplente).
 *
 * Até 07/10/2026 a situação era lida só na entrada (`AuthContext`): se a
 * academia pausasse o aluno, ou o marcasse inadimplente, com o app aberto, ele
 * seguia usando até sair e entrar de novo — no celular, onde a sessão dura
 * semanas, isso era quase nunca (auditoria de prontidão). A catraca, o
 * check-in por QR e a foto do rosto já seguiam o banco
 * (`situacao_permite_app()`), e o resto do banco não recusa o aluno pausado:
 * o portão do app (`AlunoSituacaoGate`) é de experiência, e é ele que precisa
 * da situação em dia.
 *
 * Releitura em dois momentos, sem consulta a cada tela:
 * - ao voltar para o app (a aba ou o app instalado voltam a ficar visíveis),
 *   se a última leitura tem mais de 1 minuto;
 * - de 15 em 15 minutos, enquanto o app está na tela.
 */

export const RELEITURA_INTERVALO_MS = 15 * 60 * 1000;
export const RELEITURA_ESPERA_MINIMA_MS = 60 * 1000;

/** Relê ao voltar só se a última leitura não é de agora há pouco. */
export function deveReler(ultimaLeitura: number, agora: number, esperaMinima = RELEITURA_ESPERA_MINIMA_MS): boolean {
  return agora - ultimaLeitura >= esperaMinima;
}

type Documento = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

export interface OpcoesReleitura {
  documento?: Documento;
  agora?: () => number;
  intervalo?: number;
  esperaMinima?: number;
  /** Momento da última leitura (a da entrada, para não reler logo em seguida). */
  lidoEm?: number;
}

/**
 * Liga a releitura e devolve a função que a desliga. `reler` é chamada no
 * máximo uma vez a cada `esperaMinima`, e nunca com o app escondido.
 */
export function vigiarSituacao(reler: () => void, opcoes: OpcoesReleitura = {}): () => void {
  const documento = opcoes.documento ?? document;
  const agora = opcoes.agora ?? (() => Date.now());
  const esperaMinima = opcoes.esperaMinima ?? RELEITURA_ESPERA_MINIMA_MS;
  let ultima = opcoes.lidoEm ?? agora();

  const talvezReler = () => {
    if (documento.visibilityState !== "visible") return;
    if (!deveReler(ultima, agora(), esperaMinima)) return;
    ultima = agora();
    reler();
  };

  documento.addEventListener("visibilitychange", talvezReler);
  const relogio = setInterval(talvezReler, opcoes.intervalo ?? RELEITURA_INTERVALO_MS);
  return () => {
    documento.removeEventListener("visibilitychange", talvezReler);
    clearInterval(relogio);
  };
}
