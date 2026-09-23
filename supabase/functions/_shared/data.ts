/**
 * A data do negócio é a de Brasília — aqui também.
 *
 * O espelho de `src/lib/dataBrasilia.ts`, duplicado em Deno pelo motivo de
 * sempre: edge function não importa do bundle do app.
 *
 * Em 23/09/2026 o banco passou de UTC para `America/Sao_Paulo`, e a varredura
 * que veio junto encontrou os mesmos três padrões que o frontend tinha:
 *
 *   * `new Date().toISOString().slice(0, 10)` — data em UTC. Das 21h à
 *     meia-noite de Brasília devolve o dia seguinte. Era o que gravava
 *     `data_pagamento` no `asaas-webhook`: pagamento confirmado às 22h
 *     entrava como sendo de amanhã, e no último dia do mês caía no mês
 *     seguinte do fechamento que vai para o contador;
 *   * `getTime() - 3 * 60 * 60 * 1000` — o deslocamento escrito à mão. Acerta
 *     o valor e erra o motivo: some no horário de verão e não se explica;
 *   * `toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })` — o
 *     certo, que já existia em dois lugares e virou este módulo.
 */

/** A data de Brasília de um instante, em `YYYY-MM-DD` (formato das colunas `date`). */
export function dataBrasilia(momento: Date = new Date()): string {
  // "en-CA" já formata como YYYY-MM-DD.
  return momento.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Hoje, em Brasília. */
export function hojeBrasilia(): string {
  return dataBrasilia();
}

/** A data de Brasília `dias` antes (negativo) ou depois de um instante. */
export function diaBrasilia(dias: number, momento: Date = new Date()): string {
  return dataBrasilia(new Date(momento.getTime() + dias * 86_400_000));
}
