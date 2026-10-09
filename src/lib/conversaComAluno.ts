import { temNutricaoNoPlano, type PlanoAluno } from "@/lib/planoAluno";

/**
 * Com quem da equipe da academia o aluno conversa, e por qual canal.
 *
 * É a regra que a ficha do aluno e a caixa de Mensagens já aplicavam, num
 * lugar só, para a fila de atendimento abrir a conversa direto do cartão
 * (09/10/2026) sem dar acesso novo a ninguém. O banco diz o mesmo nas regras
 * de `mensagens_treino` e `mensagens_dieta` (20261400010000); a tela só não
 * oferece o que ele recusaria.
 */

/** Os canais como o `ChatPanel` os chama. */
export type CanalConversa = "treino" | "nutri";

/**
 * Canais que cada papel atende: o professor responde o chat de treino, a
 * nutricionista o de dieta; a gestão e a ArkeFit veem os dois. A recepção vê
 * só o de treino: a conversa da nutrição é saúde, e o banco não a entrega a
 * quem não atende a saúde (20261399010000).
 */
export function canaisDoPapel(papel: string | null | undefined): Array<"treino" | "dieta"> {
  if (papel === "professor" || papel === "recepcao") return ["treino"];
  if (papel === "nutricionista") return ["dieta"];
  return ["treino", "dieta"];
}

export type ContextoConversa = {
  /** Papel na academia (`organizationRole`). */
  papel: string | null | undefined;
  /** `atendeSaude()` de quem pede: a gestão, o professor e a nutricionista. */
  veSaude: boolean;
  /** `planoDoAluno()` do aluno. */
  plano: PlanoAluno;
  /** A academia tem nutricionista ativa (`academia_tem_nutricionista`). */
  academiaTemNutri: boolean;
};

/**
 * Os canais em que esta pessoa da academia conversa com este aluno, na ordem
 * em que a conversa abre. Vazio: o botão de mensagem não aparece.
 *
 * - Aluno do Método: nenhum. Treino e dieta são do mentor da ArkeFit, e a
 *   conversa com a academia fica só como histórico, na ficha.
 * - Treino: quem atende o canal de treino pelo papel (todos, menos a
 *   nutricionista).
 * - Nutrição: quem atende o canal de dieta pelo papel, atende a saúde (a
 *   recepção, nunca) e a academia tem nutricionista (no Free, o chat da
 *   nutrição sem nutricionista na equipe é o do Método).
 */
export function canaisDaConversaComAluno(c: ContextoConversa): CanalConversa[] {
  if (c.plano !== "free") return [];
  const doPapel = canaisDoPapel(c.papel);
  const canais: CanalConversa[] = [];
  if (doPapel.includes("treino")) canais.push("treino");
  if (doPapel.includes("dieta") && c.veSaude && (temNutricaoNoPlano(c.plano) || c.academiaTemNutri)) canais.push("nutri");
  return canais;
}

export const ROTULO_CANAL: Record<CanalConversa, string> = {
  treino: "Chat Treino",
  nutri: "Chat Nutrição",
};
