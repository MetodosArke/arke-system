import termosUso from "@/content/legal/termos-uso.md?raw";
import privacidade from "@/content/legal/privacidade.md?raw";
import contratoAcademia from "@/content/legal/contrato-academia.md?raw";
import type { TipoDocumento } from "@/lib/documentosLegais";

/**
 * O texto dos documentos legais, separado da versão e do hash
 * (`documentosLegais.ts`) para ficar fora do pacote principal: só a página do
 * documento e a etapa do contrato na implantação, que já são baixadas à parte,
 * importam daqui. `documentosLegais.test.ts` confere o hash de cada texto.
 */
export const TEXTO_DOCUMENTO: Record<TipoDocumento, string> = {
  termos_uso: termosUso,
  privacidade,
  contrato_academia: contratoAcademia,
};
