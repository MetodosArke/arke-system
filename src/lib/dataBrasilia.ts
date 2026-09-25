/**
 * A data do negócio é a de Brasília — no banco e aqui.
 *
 * Em 23/09/2026 o fuso do banco passou de UTC para `America/Sao_Paulo`
 * (`20261221010000_fuso_brasilia.sql`), porque `current_date` em UTC fazia
 * quem treina às 22h ter o treino gravado como sendo de amanhã. O frontend
 * tinha o mesmo defeito, pelo caminho mais comum de todos:
 *
 *     new Date().toISOString().slice(0, 10)   // ← data em UTC, não a local
 *
 * `toISOString()` sempre converte para UTC. Das 21h à meia-noite de Brasília
 * ele devolve o dia seguinte. Enquanto banco e app erravam juntos ninguém
 * notava; com o banco certo, os dois passariam a **discordar** por três horas
 * toda noite — o aluno registra o treino, o banco grava hoje, e a tela
 * pergunta por amanhã e responde "você ainda não treinou hoje".
 *
 * O fuso é fixo em São Paulo, e não o do aparelho, porque a data que importa
 * é a da academia. Aluno viajando, ou celular com fuso errado, veria uma
 * semana de treinos diferente da que a academia vê — e o banco, que decide
 * com São Paulo, discordaria da tela. Era o que o padrão
 * `getTime() - offset * 60_000` (a data local do aparelho) deixava passar.
 */

const FORMATO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * A data de Brasília de um instante, no formato `YYYY-MM-DD` — o mesmo das
 * colunas `date` do Postgres, para comparar e gravar sem conversão.
 */
export function dataBrasilia(momento: Date = new Date()): string {
  // "en-CA" já formata como YYYY-MM-DD; montar a string por partes só daria
  // mais chance de errar o preenchimento com zero.
  return FORMATO.format(momento);
}

/** Hoje, em Brasília. */
export function hojeBrasilia(): string {
  return dataBrasilia();
}

/** A data de Brasília `dias` antes (negativo) ou depois de um instante. */
export function diaBrasilia(dias: number, momento: Date = new Date()): string {
  return dataBrasilia(new Date(momento.getTime() + dias * 86_400_000));
}

/** O primeiro dia do mês corrente em Brasília, como `YYYY-MM-01`. */
export function inicioDoMesBrasilia(momento: Date = new Date()): string {
  return `${dataBrasilia(momento).slice(0, 7)}-01`;
}

const DATA_PURA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Uma data para a tela, no formato brasileiro e no fuso de Brasília.
 *
 * `new Date("2026-07-01").toLocaleDateString("pt-BR")` mostra **30/06/2026**:
 * uma data pura é lida como meia-noite em UTC, que em Brasília ainda é o dia
 * anterior. Era assim em cerca de trinta telas — treino válido até um dia
 * antes do que a equipe definiu, avaliação física registrada na véspera,
 * mensalidade de julho mostrada como de junho. Data pura é lida ao meio-dia
 * de Brasília, longe de qualquer virada; data com hora vira a data de
 * Brasília daquele instante.
 */
export function formatarDataBR(valor: string | Date | null | undefined, opcoes: Intl.DateTimeFormatOptions = {}): string {
  if (!valor) return "—";
  const momento = typeof valor === "string" && DATA_PURA.test(valor) ? new Date(`${valor}T12:00:00-03:00`) : new Date(valor);
  if (Number.isNaN(momento.getTime())) return "—";
  const padrao: Intl.DateTimeFormatOptions = Object.keys(opcoes).length ? {} : { day: "2-digit", month: "2-digit", year: "numeric" };
  return momento.toLocaleDateString("pt-BR", { ...padrao, ...opcoes, timeZone: "America/Sao_Paulo" });
}
