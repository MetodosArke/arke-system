import { comPrazo } from "@/lib/tentativas";

/**
 * O "Sair" do app, passo a passo.
 *
 * Até 06/10/2026 o "Sair" só zerava o estado da tela. O cache das consultas
 * ficava, e quem entrava na mesma aba via por um instante os dados de quem
 * saiu. O aparelho continuava recebendo os avisos da conta. A sessão saía com
 * o escopo global, derrubando a pessoa em todos os aparelhos. E no perfil
 * simulado a cópia da sessão da ArkeFit ficava na aba, de modo que o próximo
 * login ali pulava o aceite de documentos e as duas etapas.
 *
 * A ordem importa:
 *  1. Na simulação, volta primeiro para a conta da ArkeFit, encerrando a
 *     sessão simulada e apagando a cópia. Daí em diante é um "Sair" comum
 *     dessa conta: sair nunca deixa uma conta da ArkeFit aberta na aba.
 *  2. Os avisos do aparelho saem antes da sessão, porque só a própria pessoa,
 *     ainda conectada, pode apagar a linha dela. O passo tem prazo: um
 *     navegador lento não segura a saída.
 *  3. A sessão sai só deste aparelho (escopo local).
 *  4. A aba é limpa sempre, mesmo que algum passo anterior tenha falhado.
 */
export interface PassosDaSaida {
  emSimulacao(): boolean;
  /** Encerra a sessão simulada e devolve a aba à conta da ArkeFit. */
  encerrarSimulacao(): Promise<unknown>;
  /** Quem está na sessão agora. Depois do passo 1, é a conta da ArkeFit. */
  pessoaDaSessao(): Promise<string | null>;
  esquecerAvisos(userId: string | null): Promise<void>;
  /** Encerra a sessão só neste aparelho. */
  encerrarSessao(): Promise<unknown>;
  /** Cache das consultas, rascunhos, cópia da simulação e o estado da tela. */
  limparAba(): void;
}

export const PRAZO_AVISOS_MS = 4000;

export async function sair(passos: PassosDaSaida, prazoAvisosMs = PRAZO_AVISOS_MS): Promise<void> {
  try {
    if (passos.emSimulacao()) await passos.encerrarSimulacao();
  } catch (erro) {
    console.error("Não foi possível encerrar a simulação", erro);
  }

  let userId: string | null = null;
  try {
    userId = await passos.pessoaDaSessao();
  } catch {
    userId = null;
  }

  await comPrazo(passos.esquecerAvisos(userId), prazoAvisosMs);

  try {
    await passos.encerrarSessao();
  } catch (erro) {
    console.error("Não foi possível encerrar a sessão no servidor", erro);
  }

  passos.limparAba();
}

/**
 * Apaga a sessão guardada no navegador. É o recurso para quando o
 * `signOut` falha antes de apagar (sem rede, com o token vencido): sem isto a
 * sessão voltaria na próxima abertura do app.
 */
export function apagarSessaoGuardada(armazens: Storage[] = armazensDoNavegador()): number {
  let apagadas = 0;
  for (const armazem of armazens) {
    try {
      const chaves: string[] = [];
      for (let i = 0; i < armazem.length; i++) {
        const chave = armazem.key(i) ?? "";
        if (chave.startsWith("sb-") && chave.includes("-auth-token")) chaves.push(chave);
      }
      for (const chave of chaves) armazem.removeItem(chave);
      apagadas += chaves.length;
    } catch {
      // Armazenamento bloqueado: não há o que apagar nele.
    }
  }
  return apagadas;
}

function armazensDoNavegador(): Storage[] {
  try {
    return [window.localStorage, window.sessionStorage];
  } catch {
    return [];
  }
}
