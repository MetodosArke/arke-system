// Quando avisar o aluno da mensalidade vencida, sem Deno e sem Supabase, para
// o teste do app exercitar o código real (15/10/2026).
//
// Dois avisos no celular, dentro dos 5 dias de tolerância, antes do bloqueio:
// o do D+1 e o do D+3. Cada um tem uma janela, e não um dia só, para a rotina
// que falhou ou o domingo sem aviso não perderem a etapa: o do D+1 sai no D+1
// ou no D+2; o do D+3, do D+3 ao D+5. A janela do D+3 começa depois da do
// D+1, então o aluno nunca recebe os dois no mesmo dia. Passado o D+5, o
// aluno está bloqueado (a marca de inadimplente é do D+1, e o acesso segue
// por 5 dias): o aviso já não muda nada, e o Asaas segue com os dele.

/** Horário comercial de Brasília: das 9h às 18h, de segunda a sábado. */
export const HORARIO_COMERCIAL = { inicio: 9, fim: 18 };

export const TOLERANCIA_DIAS = 5;

export type Etapa = "d1" | "d3";

/** A coluna de `mensalidades` que reserva cada etapa: preenchida, o aviso não sai de novo. */
export const COLUNA_DA_ETAPA: Record<Etapa, "aviso_cobranca_d1_em" | "aviso_cobranca_d3_em"> = {
  d1: "aviso_cobranca_d1_em",
  d3: "aviso_cobranca_d3_em",
};

/**
 * O aviso. A tela bloqueada do celular é pública: nada de valor, de nome da
 * academia ou de data. E o toque abre o app, nunca a fatura direto: um aviso
 * "pague aqui" com link de fora seria o golpe perfeito (send-chat-push/regras.ts).
 * A home mostra a mensalidade em aberto como Próxima Ação, com o botão da fatura.
 */
export const AVISO_COBRANCA = {
  title: "Mensalidade em aberto",
  body: "Sua mensalidade está em aberto. Toque para pagar.",
  url: "/#/app",
  tag: "cobranca-atrasada",
};

/** O tópico do push (até 32 caracteres): com o aparelho desligado, fica só o último aviso. */
export const TOPICO_COBRANCA = "cobrancaatrasada";

const RELOGIO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const DIAS_DA_SEMANA = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** O dia (`YYYY-MM-DD`), a hora e o dia da semana (0 = domingo) em Brasília. */
export function relogioBrasilia(momento: Date): { hoje: string; hora: number; diaDaSemana: number } {
  const p = Object.fromEntries(RELOGIO.formatToParts(momento).map((x) => [x.type, x.value]));
  return { hoje: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), diaDaSemana: DIAS_DA_SEMANA.indexOf(p.weekday) };
}

export function emHorarioComercial(r: { hora: number; diaDaSemana: number }): boolean {
  return r.diaDaSemana !== 0 && r.hora >= HORARIO_COMERCIAL.inicio && r.hora < HORARIO_COMERCIAL.fim;
}

/** Quantos dias depois do vencimento está `hoje` (datas `YYYY-MM-DD`). */
export function diasDeAtraso(vencimento: string, hoje: string): number {
  return Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${vencimento}T12:00:00Z`)) / 86_400_000);
}

export type MensalidadeVencida = {
  vencimento: string;
  aviso_cobranca_d1_em: string | null;
  aviso_cobranca_d3_em: string | null;
};

/** A etapa que sai hoje para esta mensalidade, ou nenhuma. */
export function etapaDoAviso(m: MensalidadeVencida, hoje: string): Etapa | null {
  const dias = diasDeAtraso(m.vencimento, hoje);
  if (dias >= 1 && dias <= 2) return m.aviso_cobranca_d1_em ? null : "d1";
  if (dias >= 3 && dias <= TOLERANCIA_DIAS) return m.aviso_cobranca_d3_em ? null : "d3";
  return null;
}
