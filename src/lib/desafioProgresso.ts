// Cálculo de progresso automático dos desafios (portado do app original,
// simplificado): cada tipo de desafio compara um valor agregado do aluno
// no período com a meta definida pelo staff. "livre" não tem cálculo
// automático — depende do staff marcar manualmente como concluído.
export type DesafioTipo =
  | "sem_doce"
  | "sem_alcool"
  | "consumo_agua"
  | "numero_treinos"
  | "modalidades"
  | "desempenho_dieta"
  | "livre";

// Tipos "inversos": quanto MENOR o valor, melhor (a meta é o limite máximo permitido).
export const TIPOS_INVERSOS: DesafioTipo[] = ["sem_doce", "sem_alcool"];

export const DESAFIO_TIPO_LABEL: Record<DesafioTipo, { label: string; emoji: string; unidade: string }> = {
  sem_doce: { label: "Sem doce", emoji: "🍰", unidade: "dias com doce" },
  sem_alcool: { label: "Sem álcool", emoji: "🍷", unidade: "dias com álcool" },
  consumo_agua: { label: "Meta de água", emoji: "💧", unidade: "ml" },
  numero_treinos: { label: "Número de treinos", emoji: "🏋️", unidade: "treinos" },
  modalidades: { label: "Variedade de modalidades", emoji: "⚡", unidade: "modalidades" },
  desempenho_dieta: { label: "Desempenho da dieta", emoji: "🥗", unidade: "% de adesão" },
  livre: { label: "Desafio livre (manual)", emoji: "🎯", unidade: "" },
};

export interface DadosPeriodoAluno {
  diasComDoce: number;
  diasComAlcool: number;
  aguaTotalMl: number;
  treinosConcluidos: number;
  modalidadesDistintas: number;
  adesaoDietaMedia: number;
}

export function calcularValorAtual(tipo: DesafioTipo, dados: DadosPeriodoAluno): number | null {
  switch (tipo) {
    case "sem_doce":
      return dados.diasComDoce;
    case "sem_alcool":
      return dados.diasComAlcool;
    case "consumo_agua":
      return dados.aguaTotalMl;
    case "numero_treinos":
      return dados.treinosConcluidos;
    case "modalidades":
      return dados.modalidadesDistintas;
    case "desempenho_dieta":
      return dados.adesaoDietaMedia;
    case "livre":
      return null;
  }
}

export type StatusDesafio = "cumprido" | "superado" | "falhado" | "em_andamento";

export function statusDesafio(
  tipo: DesafioTipo,
  metaValor: number | null,
  valorAtual: number | null,
  concluidoManual: boolean,
  encerrado: boolean
): StatusDesafio {
  if (tipo === "livre") {
    if (concluidoManual) return "cumprido";
    return encerrado ? "falhado" : "em_andamento";
  }
  if (metaValor == null || valorAtual == null) return "em_andamento";

  const inverso = TIPOS_INVERSOS.includes(tipo);
  if (inverso) {
    if (valorAtual > metaValor) return "falhado";
    return encerrado ? "cumprido" : "em_andamento";
  }

  if (encerrado) {
    if (valorAtual >= metaValor) return valorAtual > metaValor ? "superado" : "cumprido";
    return "falhado";
  }
  return valorAtual >= metaValor ? "cumprido" : "em_andamento";
}

export function progressoPercentual(tipo: DesafioTipo, metaValor: number | null, valorAtual: number | null): number {
  if (metaValor == null || valorAtual == null || metaValor <= 0) return 0;
  const inverso = TIPOS_INVERSOS.includes(tipo);
  const bruto = Math.min(100, (valorAtual / metaValor) * 100);
  return inverso ? Math.max(0, 100 - bruto) : bruto;
}
