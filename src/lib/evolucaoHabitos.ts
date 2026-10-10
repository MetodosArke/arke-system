import { semanaBrasilia } from "@/lib/dataBrasilia";

/**
 * Os hábitos do aluno semana a semana, para os gráficos da Evolução.
 *
 * Só entra o que o app já coleta com data: os dias de treino (registro_treino
 * concluído e o calendário de treinos), o esforço percebido no fim do treino
 * (1 a 10), o sono e a energia que o aluno marca no fim do treino (1 a 5, desde
 * 10/10/2026), a adesão à dieta do dia (0 a 100%) e a água do dia. Semana sem
 * resposta fica nula, em branco no gráfico (sem dado inventado).
 *
 * As semanas são as de Brasília, de domingo a sábado, como no calendário de
 * treinos e no resumo da dieta, e as datas se comparam como texto.
 */

export type ValorDoDia = { data: string; valor: number };

export type SemanaDeHabitos = {
  /** O domingo da semana, `YYYY-MM-DD`. */
  inicio: string;
  /** Dias distintos com treino na semana. */
  diasDeTreino: number;
  /** Média do esforço percebido dos treinos da semana, ou null sem registro. */
  esforcoMedio: number | null;
  /** Média do sono (1 a 5) marcado no fim dos treinos da semana, ou null. */
  sonoMedio: number | null;
  /** Média da energia (1 a 5) marcada no fim dos treinos da semana, ou null. */
  energiaMedia: number | null;
  /** Média da adesão à dieta dos dias registrados, ou null sem registro. */
  adesaoMedia: number | null;
  /** Média da água dos dias com água registrada, em ml, ou null. */
  aguaMedia: number | null;
};

const meioDia = (data: string) => new Date(`${data}T12:00:00-03:00`);

/** O domingo da semana de uma data pura. */
export function inicioDaSemana(data: string): string {
  return semanaBrasilia(meioDia(data)).inicio;
}

/** Os domingos das últimas `n` semanas até a de `hoje`, da mais antiga para a atual. */
export function ultimasSemanas(hoje: string, n: number): string[] {
  const atual = meioDia(inicioDaSemana(hoje)).getTime();
  return Array.from({ length: n }, (_, i) => semanaBrasilia(new Date(atual - (n - 1 - i) * 7 * 86_400_000)).inicio);
}

function media(valores: number[]): number | null {
  return valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
}

function porSemana(itens: ValorDoDia[]): Map<string, number[]> {
  const mapa = new Map<string, number[]>();
  for (const { data, valor } of itens) {
    const semana = inicioDaSemana(data);
    mapa.set(semana, [...(mapa.get(semana) ?? []), valor]);
  }
  return mapa;
}

export function habitosPorSemana({
  semanas,
  diasDeTreino,
  esforcos,
  sonos,
  energias,
  adesoes,
  aguas,
}: {
  semanas: string[];
  /** Datas com treino; a mesma data repetida (ficha e calendário) conta uma vez. */
  diasDeTreino: string[];
  esforcos: ValorDoDia[];
  sonos: ValorDoDia[];
  energias: ValorDoDia[];
  adesoes: ValorDoDia[];
  aguas: ValorDoDia[];
}): SemanaDeHabitos[] {
  const treinos = porSemana([...new Set(diasDeTreino)].map((data) => ({ data, valor: 1 })));
  const esforco = porSemana(esforcos);
  const sono = porSemana(sonos);
  const energia = porSemana(energias);
  const adesao = porSemana(adesoes);
  // Dia com 0 ml é o registro do dia sem água marcada (só as refeições), não um dia sem beber.
  const agua = porSemana(aguas.filter((a) => a.valor > 0));
  return semanas.map((inicio) => ({
    inicio,
    diasDeTreino: treinos.get(inicio)?.length ?? 0,
    esforcoMedio: media(esforco.get(inicio) ?? []),
    sonoMedio: media(sono.get(inicio) ?? []),
    energiaMedia: media(energia.get(inicio) ?? []),
    adesaoMedia: media(adesao.get(inicio) ?? []),
    aguaMedia: media(agua.get(inicio) ?? []),
  }));
}

/**
 * Constância contra a meta do próprio aluno: em quantas semanas fechadas (sem
 * a atual, que ainda corre) ele treinou os dias da meta dele.
 */
export function semanasNaMeta(semanas: SemanaDeHabitos[], metaSemanalDias: number): { batidas: number; fechadas: number } {
  const fechadas = semanas.slice(0, -1);
  return { batidas: fechadas.filter((s) => s.diasDeTreino >= metaSemanalDias).length, fechadas: fechadas.length };
}
