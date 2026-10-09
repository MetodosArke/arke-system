import type { CanalConversa } from "@/lib/conversaComAluno";

/**
 * Quem escreveu cada mensagem da conversa do aluno com a academia (treino e
 * nutrição), como o `ChatPanel` mostra.
 *
 * Até 09/10/2026 a tela decidia pelo `remetente_tipo`: do lado da equipe,
 * toda mensagem da equipe era "Você", de quem fosse. Na Ponto Alto, a gestora
 * e o professor escreveram para a mesma aluna, e o professor via as duas
 * mensagens como dele. O banco guarda quem enviou (`remetente_id`); a regra
 * agora lê ele.
 *
 * - **Equipe:** a própria mensagem é "Você"; a de outra pessoa da equipe leva
 *   o nome dela (lido de `profiles`, pelo RLS de quem pede). Nome que não
 *   carrega (a pessoa saiu da academia, a leitura falhou) cai em
 *   `EQUIPE_SEM_NOME`, e a conversa segue.
 * - **Aluno:** continua vendo a função ("Treinador(a)", "Nutricionista"). O
 *   aluno não lê o perfil da equipe (a regra de `profiles` só entrega o nome a
 *   quem é da equipe da mesma academia), e a conversa não abre acesso novo.
 */

export type LadoDaConversa = "aluno" | "staff";

export type MensagemComRemetente = {
  remetente_tipo: string;
  remetente_id: string | null;
};

export type Remetente = {
  /** O que aparece em cima da bolha. */
  rotulo: string;
  /** Escrita por quem está com a conversa aberta. */
  minha: boolean;
  /** Escrita por alguém da equipe da academia. */
  daEquipe: boolean;
  /** Do mesmo lado de quem lê (a equipe toda, para a equipe), e por isso à direita. */
  doMeuLado: boolean;
};

/** Rótulo da mensagem de outra pessoa da equipe cujo nome não carregou. */
export const EQUIPE_SEM_NOME = "Equipe da academia";

/** Como o aluno vê quem respondeu, por canal. */
export const EQUIPE_PARA_O_ALUNO: Record<CanalConversa, string> = {
  treino: "Treinador(a)",
  nutri: "Nutricionista",
};

export function remetenteDaMensagem(
  msg: MensagemComRemetente,
  c: {
    lado: LadoDaConversa;
    canal: CanalConversa;
    meuUserId: string | null | undefined;
    nomes: ReadonlyMap<string, string>;
  },
): Remetente {
  const daEquipe = msg.remetente_tipo !== "aluno";
  if (c.lado === "aluno") {
    return {
      rotulo: daEquipe ? EQUIPE_PARA_O_ALUNO[c.canal] : "Você",
      minha: !daEquipe,
      daEquipe,
      doMeuLado: !daEquipe,
    };
  }
  if (!daEquipe) return { rotulo: "Aluno", minha: false, daEquipe, doMeuLado: false };
  const minha = !!c.meuUserId && msg.remetente_id === c.meuUserId;
  const nome = msg.remetente_id ? c.nomes.get(msg.remetente_id)?.trim() : undefined;
  return { rotulo: minha ? "Você" : nome || EQUIPE_SEM_NOME, minha, daEquipe, doMeuLado: true };
}

/**
 * Os ids das outras pessoas da equipe que escreveram na conversa, sem repetir
 * e em ordem (é a chave da consulta dos nomes). Do lado do aluno, nenhum: ele
 * não lê o nome da equipe.
 */
export function colegasNaConversa(
  mensagens: readonly MensagemComRemetente[],
  lado: LadoDaConversa,
  meuUserId: string | null | undefined,
): string[] {
  if (lado !== "staff") return [];
  const ids = new Set<string>();
  for (const m of mensagens) {
    if (m.remetente_tipo !== "aluno" && m.remetente_id && m.remetente_id !== meuUserId) ids.add(m.remetente_id);
  }
  return [...ids].sort();
}
