/**
 * O modelo dos GIFs de exercício (decisão de 09/10/2026).
 *
 * O acervo global traz cada exercício com um GIF de modelo masculino e um de
 * modelo feminino. Quem vê escolhe qual quer ver, e a escolha fica em
 * `profiles.modelo_exercicio`. O app não pergunta nem guarda o sexo de
 * ninguém: é preferência de exibição, trocável na própria tela do exercício.
 */
export type ModeloExercicio = "masculino" | "feminino";

export const ROTULO_MODELO: Record<ModeloExercicio, string> = {
  masculino: "Modelo masculino",
  feminino: "Modelo feminino",
};

/** As colunas de mídia do exercício, do acervo ou do snapshot do treino. */
export type MidiasDoExercicio = {
  gif_url?: string | null;
  video_url?: string | null;
  gif_masculino_url?: string | null;
  gif_feminino_url?: string | null;
};

export type MidiaEscolhida = {
  /** A imagem/GIF a mostrar, ou null. */
  imagemUrl: string | null;
  /** O vídeo, como sempre foi: não depende do modelo. */
  videoUrl: string | null;
  /** O modelo do GIF mostrado; null quando é a mídia única (`gif_url`) ou nenhuma. */
  modeloMostrado: ModeloExercicio | null;
  /** O exercício tem os dois modelos: só aí a tela oferece a troca. */
  temOsDois: boolean;
};

const limpo = (url: string | null | undefined) => (url && url.trim() ? url : null);

/** Lê o valor gravado no banco; qualquer outra coisa conta como "não escolheu". */
export function lerModelo(valor: string | null | undefined): ModeloExercicio | null {
  return valor === "masculino" || valor === "feminino" ? valor : null;
}

/**
 * Qual mídia mostrar: o GIF do modelo escolhido; sem ele, o do outro modelo;
 * sem os dois, o `gif_url`. Sem escolha, vale o masculino (e a tela do aluno
 * pergunta). O vídeo segue como sempre.
 */
export function escolherMidiaExercicio(midias: MidiasDoExercicio, preferencia: ModeloExercicio | null): MidiaEscolhida {
  const gifs: Record<ModeloExercicio, string | null> = {
    masculino: limpo(midias.gif_masculino_url),
    feminino: limpo(midias.gif_feminino_url),
  };
  const desejado: ModeloExercicio = preferencia ?? "masculino";
  const outro: ModeloExercicio = desejado === "masculino" ? "feminino" : "masculino";
  const modeloMostrado = gifs[desejado] ? desejado : gifs[outro] ? outro : null;
  return {
    imagemUrl: modeloMostrado ? gifs[modeloMostrado] : limpo(midias.gif_url),
    videoUrl: limpo(midias.video_url),
    modeloMostrado,
    temOsDois: !!gifs.masculino && !!gifs.feminino,
  };
}

/**
 * A pergunta aparece só para quem ainda não escolheu, não pulou, e está vendo
 * pelo menos um exercício que tem os dois modelos — antes de os GIFs subirem,
 * perguntar não mudaria nada na tela.
 */
export function devePerguntarModelo(
  preferencia: ModeloExercicio | null,
  { carregada, pulou }: { carregada: boolean; pulou: boolean },
  exercicios: MidiasDoExercicio[],
): boolean {
  if (!carregada || pulou || preferencia) return false;
  return exercicios.some((ex) => escolherMidiaExercicio(ex, null).temOsDois);
}
