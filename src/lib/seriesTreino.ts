/**
 * Séries individuais e divisões da prescrição (A, B, C...), trazidas do app
 * original. No original a quebra por série era texto ("12,10,8" em
 * `repeticoes` e "60,60,90" em `descanso_por_serie`); aqui é uma lista em
 * `series_detalhe`, e `series`/`repeticoes`/`descanso_seg` continuam
 * preenchidos como resumo — fichas publicadas antes disto só têm o resumo, e
 * são lidas como "todas as séries iguais".
 */
export type TecnicaSerie = "drop_set" | "rest_pause" | "bi_set" | "isometria" | "falha";

export const TECNICAS: { valor: TecnicaSerie; rotulo: string }[] = [
  { valor: "drop_set", rotulo: "Drop-set" },
  { valor: "rest_pause", rotulo: "Rest-pause" },
  { valor: "bi_set", rotulo: "Bi-set" },
  { valor: "isometria", rotulo: "Isometria" },
  { valor: "falha", rotulo: "Até a falha" },
];

export const rotuloTecnica = (t: string | null | undefined) => TECNICAS.find((x) => x.valor === t)?.rotulo ?? null;

export type SerieDetalhe = { reps: string; descanso_seg: number; tecnica?: TecnicaSerie | null };

export const DIVISOES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

type ExercicioComSeries = {
  series?: number | null;
  repeticoes?: string | null;
  descanso_seg?: number | null;
  series_detalhe?: unknown;
};

function ehSerie(x: unknown): x is SerieDetalhe {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return typeof s.reps === "string" && typeof s.descanso_seg === "number";
}

/** As séries do exercício, uma a uma. Sem detalhe, repete o resumo. */
export function seriesDoExercicio(ex: ExercicioComSeries): SerieDetalhe[] {
  if (Array.isArray(ex.series_detalhe) && ex.series_detalhe.length > 0 && ex.series_detalhe.every(ehSerie)) {
    return ex.series_detalhe.map((s) => ({ reps: s.reps, descanso_seg: s.descanso_seg, tecnica: s.tecnica ?? null }));
  }
  const n = Math.max(1, Number(ex.series) || 1);
  return Array.from({ length: n }, () => ({ reps: ex.repeticoes ?? "", descanso_seg: Number(ex.descanso_seg) || 0, tecnica: null }));
}

/** Todas as séries iguais? (Aí não vale a pena guardar o detalhe.) */
export function seriesUniformes(series: SerieDetalhe[]): boolean {
  return series.every((s) => s.reps === series[0].reps && s.descanso_seg === series[0].descanso_seg && !s.tecnica);
}

/**
 * Resumo para os campos antigos. Repetições diferentes viram "12-10-8";
 * iguais ficam "12". O descanso do resumo é o da primeira série.
 */
export function resumoSeries(series: SerieDetalhe[]): { series: number; repeticoes: string; descanso_seg: number } {
  const reps = series.map((s) => s.reps.trim()).filter(Boolean);
  const todasIguais = reps.every((r) => r === reps[0]);
  return {
    series: series.length,
    repeticoes: reps.length === 0 ? "" : todasIguais ? reps[0] : reps.join("-"),
    descanso_seg: series[0]?.descanso_seg ?? 0,
  };
}

/** O que gravar: detalhe só quando as séries diferem entre si. */
export function paraGravar(series: SerieDetalhe[]) {
  return { ...resumoSeries(series), series_detalhe: seriesUniformes(series) ? null : series };
}

/** Divisões presentes no treino, em ordem. Ficha antiga (sem divisão) é "A". */
export function divisoesDoTreino(exercicios: { divisao?: string | null }[]): string[] {
  return [...new Set(exercicios.map((e) => e.divisao || "A"))].sort();
}
