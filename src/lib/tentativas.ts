/**
 * Tentar de novo, e não esperar para sempre.
 *
 * Uma leitura que falha por um instante de rede não é resposta. Até 06/10/2026
 * o app tratava a falha ao ler os papéis e os vínculos como "sem vínculo", e a
 * gestão era mandada para o app do aluno, onde a tela ficava em "carregando"
 * para sempre. A regra agora: tenta algumas vezes, com espera crescente, e só
 * então diz que não conseguiu.
 */

/** A pessoa saiu (ou outra entrou) no meio das tentativas: o resultado não interessa mais. */
export class TentativasInterrompidas extends Error {
  constructor() {
    super("Tentativas interrompidas");
    this.name = "TentativasInterrompidas";
  }
}

export interface OpcoesTentativas {
  /** Quantas vezes tenta ao todo, contando a primeira. */
  tentativas?: number;
  /** Espera antes da segunda tentativa; dobra a cada nova. */
  esperaInicialMs?: number;
  /** Devolve falso para parar antes da próxima tentativa. */
  continuar?: () => boolean;
  /** Só para teste: a espera de verdade é um `setTimeout`. */
  esperar?: (ms: number) => Promise<void>;
}

const esperaPadrao = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Roda `acao` até dar certo ou acabarem as tentativas. Com os padrões são
 * quatro tentativas, com 1, 2 e 4 segundos entre elas: sete segundos ao todo
 * antes de desistir. Esgotadas, lança o último erro.
 */
export async function comNovasTentativas<T>(acao: () => Promise<T>, opcoes: OpcoesTentativas = {}): Promise<T> {
  const { tentativas = 4, esperaInicialMs = 1000, continuar = () => true, esperar = esperaPadrao } = opcoes;
  let ultimoErro: unknown = new Error("Nenhuma tentativa feita");
  for (let i = 0; i < Math.max(1, tentativas); i++) {
    if (i > 0) await esperar(esperaInicialMs * 2 ** (i - 1));
    if (!continuar()) throw new TentativasInterrompidas();
    try {
      return await acao();
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  throw ultimoErro;
}

/**
 * Espera `promessa` no máximo `ms`. Passado o prazo, segue sem ela: serve para
 * passos que não podem segurar o resto, como cancelar os avisos do aparelho
 * antes de sair. A falha da promessa também é engolida, porque quem chama
 * decidiu que o passo é dispensável.
 */
export async function comPrazo(promessa: Promise<unknown>, ms: number): Promise<"pronto" | "prazo" | "falhou"> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<"prazo">((resolve) => {
    relogio = setTimeout(() => resolve("prazo"), ms);
  });
  try {
    return await Promise.race([promessa.then(() => "pronto" as const, () => "falhou" as const), prazo]);
  } finally {
    clearTimeout(relogio);
  }
}
