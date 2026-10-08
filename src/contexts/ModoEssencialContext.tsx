import { createContext, useContext } from "react";

/**
 * O painel em modo essencial: a recepção da academia com a mensalidade B2B
 * bloqueada (`src/lib/modoEssencial.ts`). Quem liga é o
 * `OrganizacaoBillingGate`; o menu, o portão das rotas e a faixa do topo leem.
 * Fora do gate, o valor é `false`: o painel de sempre.
 */
export const ModoEssencialContext = createContext(false);

export function useModoEssencial(): boolean {
  return useContext(ModoEssencialContext);
}
