// O roteiro (prompt de sistema) e o modelo de cada IA avaliada, e a
// assinatura dos dois. A avaliação grava a assinatura no registro, e
// src/lib/avaliacaoIA.guarda.test.ts falha quando o roteiro ou o modelo de
// uma IA muda sem uma avaliação nova.
import { createHash } from "node:crypto";
import { SISTEMA_ESPELHO } from "../../supabase/functions/agente-comercial/fluxo.ts";
import { SISTEMA_ASSISTENTE } from "../../supabase/functions/assistente-academia/fluxo.ts";
import { SISTEMA as SISTEMA_DIETA } from "../../supabase/functions/importar-dieta-pdf/fluxo.ts";
import { SISTEMA_VIGIA } from "../../supabase/functions/_shared/vigiaAnalise.ts";
import { MODELO_ASSISTENTE, MODELO_PADRAO, MODELO_VIGIA } from "../../supabase/functions/_shared/ia.ts";

export const IAS = {
  leticia: { roteiro: SISTEMA_ESPELHO, modelo: MODELO_PADRAO },
  assistente: { roteiro: SISTEMA_ASSISTENTE, modelo: MODELO_ASSISTENTE },
  dieta_pdf: { roteiro: SISTEMA_DIETA, modelo: MODELO_PADRAO },
  vigia: { roteiro: SISTEMA_VIGIA, modelo: MODELO_VIGIA },
};

/** sha256 do modelo e do roteiro, com quebra de linha LF. */
export function assinatura(agente) {
  const ia = IAS[agente];
  return createHash("sha256").update(`${ia.modelo}\n${ia.roteiro.replace(/\r\n/g, "\n")}`, "utf8").digest("hex");
}
