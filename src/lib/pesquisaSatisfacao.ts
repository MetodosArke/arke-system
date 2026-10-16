import { dataBrasilia, diaBrasilia } from "@/lib/dataBrasilia";

/**
 * A pesquisa de satisfação (NPS) do app do aluno, decidida em 15/10/2026.
 *
 * "De 0 a 10, quanto você recomendaria a academia a um amigo?", num cartão da
 * home abaixo da Próxima Ação (a Próxima Ação é única e fica com o que o aluno
 * precisa fazer). A nota de 0 a 6 vira tarefa da gestão na fila, e a gestão vê
 * o NPS no Gestão 360°.
 *
 * O banco confere de novo a janela ao gravar (`responder_pesquisa_satisfacao`,
 * migration 20261449010000), com os mesmos números: `pesquisaSatisfacao.test.ts`
 * cobra que os dois lados digam o mesmo.
 */

/** A primeira pergunta, contada da matrícula. */
export const PRIMEIRA_PESQUISA_DIAS = 30;
/** Depois de responder, a próxima. Uma resposta por janela. */
export const INTERVALO_PESQUISA_DIAS = 90;
/** "Agora não" adia. */
export const ADIAMENTO_PESQUISA_DIAS = 7;
/** De 0 a 6 é detrator, e a nota vira tarefa da gestão. */
export const NOTA_MAXIMA_DETRATOR = 6;

export type EstadoPesquisa = {
  /**
   * Nem pausado nem bloqueado (`situacao_permite_app`), e com a matrícula
   * ativa ou sem matrícula no ARKE: o banco decide (`pesquisa_satisfacao_do_aluno`).
   */
  liberado: boolean;
  /** `YYYY-MM-DD` */
  dataMatricula: string;
  ultimaResposta: string | null;
  ultimoAdiamento: string | null;
};

/** A data pura somada de dias, lida ao meio-dia de Brasília, longe de qualquer virada. */
const somarDias = (data: string, dias: number) => diaBrasilia(dias, new Date(`${data}T12:00:00-03:00`));

/** Se a home mostra a pesquisa hoje. Datas puras, comparadas como texto. */
export function devePerguntar(e: EstadoPesquisa, hoje: string): boolean {
  if (!e.liberado) return false;
  const abre = e.ultimaResposta
    ? somarDias(e.ultimaResposta, INTERVALO_PESQUISA_DIAS)
    : somarDias(e.dataMatricula, PRIMEIRA_PESQUISA_DIAS);
  if (hoje < abre) return false;
  return !e.ultimoAdiamento || hoje >= somarDias(e.ultimoAdiamento, ADIAMENTO_PESQUISA_DIAS);
}

export type ResumoNps = {
  respostas: number;
  promotores: number;
  neutros: number;
  detratores: number;
  /** % de promotores − % de detratores, de −100 a 100; nulo sem resposta. */
  nps: number | null;
};

export function resumoNps(notas: number[]): ResumoNps {
  const promotores = notas.filter((n) => n >= 9).length;
  const detratores = notas.filter((n) => n <= NOTA_MAXIMA_DETRATOR).length;
  const respostas = notas.length;
  return {
    respostas,
    promotores,
    neutros: respostas - promotores - detratores,
    detratores,
    nps: respostas ? Math.round(((promotores - detratores) / respostas) * 100) : null,
  };
}

/** O NPS de cada mês (de Brasília) com resposta, do mais antigo ao mais novo. */
export function npsPorMes(respostas: { nota: number; created_at: string }[]): ({ mes: string } & ResumoNps)[] {
  const porMes = new Map<string, number[]>();
  for (const r of respostas) {
    const mes = dataBrasilia(new Date(r.created_at)).slice(0, 7);
    porMes.set(mes, [...(porMes.get(mes) ?? []), r.nota]);
  }
  return [...porMes.keys()].sort().map((mes) => ({ mes, ...resumoNps(porMes.get(mes)!) }));
}
