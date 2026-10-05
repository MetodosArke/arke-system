import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assinatura, IAS } from "../../scripts/avaliacao-ia/roteiros.mjs";

/**
 * Mudou o roteiro (prompt de sistema) ou o modelo de uma IA, a avaliação roda
 * de novo: `npm run avaliar:ia` (com `-- --vigia` para o Vigia). O registro
 * mais recente de cada IA em docs/avaliacoes-ia/ guarda a assinatura do
 * roteiro e do modelo avaliados, e ela tem de ser a de agora.
 *
 * Sem esta trava, um ajuste de boa-fé no roteiro chega à produção sem
 * ninguém saber se a IA ficou melhor ou pior.
 */
const PASTA = join(__dirname, "..", "..", "docs", "avaliacoes-ia");

type Registro = { data: string; resultados: Record<string, { assinatura: string; acertos: number; total: number }> };

const registros: Registro[] = readdirSync(PASTA)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .reverse()
  .map((f) => JSON.parse(readFileSync(join(PASTA, f), "utf8")) as Registro);

describe("avaliação das IAs em dia", () => {
  for (const agente of Object.keys(IAS)) {
    it(`${agente}: o roteiro e o modelo de agora foram avaliados`, () => {
      const ultimo = registros.find((r) => r.resultados[agente]);
      expect(ultimo, `nenhuma avaliação de ${agente}: rode npm run avaliar:ia`).toBeTruthy();
      expect(
        ultimo!.resultados[agente].assinatura,
        `o roteiro ou o modelo de ${agente} mudou depois da avaliação de ${ultimo!.data}: rode npm run avaliar:ia`,
      ).toBe(assinatura(agente as keyof typeof IAS));
    });
  }
});
