import { dataBr, type Aba } from "@/lib/exportarPlanilha";

/**
 * Os relatórios de gestão do financeiro, em planilha (reunião de 10/11/2026).
 * O fechamento do contador (ExportarContador) segue pela competência; estes
 * respondem ao gestor: o que entrou no mês (pela data do pagamento), o que
 * ainda vai entrar, quem deve e há quanto tempo, e o mês por plano.
 *
 * Dívida é a lista de inclusão do bloqueio: pendente ou atrasado, vencido
 * antes de hoje. Pago é pago ou confirmado. Datas como texto, de Brasília.
 */
export type Cobranca = {
  origem: "Mensalidade" | "Avulsa";
  aluno: string;
  descricao: string;
  plano: string | null;
  competencia: string | null;
  vencimento: string;
  valor: number;
  status: string;
  data_pagamento: string | null;
  forma_pagamento: string | null;
};

const PAGO = ["pago", "confirmado"];
const EM_ABERTO = ["pendente", "atrasado"];

/** Dias corridos de `de` até `ate`, as duas `YYYY-MM-DD`. */
export function diasEntre(de: string, ate: string): number {
  const utc = (d: string) => {
    const [a, m, dia] = d.split("-").map(Number);
    return Date.UTC(a, m - 1, dia);
  };
  return Math.round((utc(ate) - utc(de)) / 86_400_000);
}

const soma = (cs: Cobranca[]) => Math.round(cs.reduce((t, c) => t + c.valor, 0) * 100) / 100;

export function montarRelatorios(cobrancas: Cobranca[], mes: string, hoje: string): Aba[] {
  const noMes = (d: string | null) => !!d && d.slice(0, 7) === mes;
  const recebidas = cobrancas.filter((c) => PAGO.includes(c.status) && noMes(c.data_pagamento));
  const aReceber = cobrancas.filter((c) => EM_ABERTO.includes(c.status) && c.vencimento >= hoje);
  const vencidas = cobrancas.filter((c) => EM_ABERTO.includes(c.status) && c.vencimento < hoje);
  const doMes = cobrancas.filter((c) => c.origem === "Mensalidade" && noMes(c.competencia));

  const porForma = new Map<string, Cobranca[]>();
  for (const c of recebidas) {
    const f = c.forma_pagamento || "Não informada";
    porForma.set(f, [...(porForma.get(f) ?? []), c]);
  }
  const porPlano = new Map<string, Cobranca[]>();
  for (const c of doMes) {
    const p = c.plano || "Sem plano";
    porPlano.set(p, [...(porPlano.get(p) ?? []), c]);
  }
  const ordenarPorValor = (m: Map<string, Cobranca[]>) => [...m].sort((a, b) => soma(b[1]) - soma(a[1]));

  return [
    {
      nome: "Resumo",
      linhas: [
        ["Relatório do mês", mes.split("-").reverse().join("/")],
        ["Gerado em", dataBr(hoje)],
        [],
        ["Indicador", "Quantidade", "Valor"],
        ["Recebido no mês", recebidas.length, soma(recebidas)],
        ["A receber (a vencer)", aReceber.length, soma(aReceber)],
        ["Em atraso", vencidas.length, soma(vencidas)],
        [],
        ["Recebido por forma de pagamento", "Quantidade", "Valor"],
        ...ordenarPorValor(porForma).map(([f, cs]) => [f, cs.length, soma(cs)]),
      ],
    },
    {
      nome: "Recebidas",
      linhas: [
        ["Pagamento", "Aluno", "Origem", "Descrição", "Vencimento", "Valor", "Forma"],
        ...recebidas
          .sort((a, b) => (a.data_pagamento ?? "").localeCompare(b.data_pagamento ?? ""))
          .map((c) => [dataBr(c.data_pagamento), c.aluno, c.origem, c.descricao, dataBr(c.vencimento), c.valor, c.forma_pagamento]),
      ],
    },
    {
      nome: "A receber",
      linhas: [
        ["Vencimento", "Aluno", "Origem", "Descrição", "Valor"],
        ...aReceber
          .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
          .map((c) => [dataBr(c.vencimento), c.aluno, c.origem, c.descricao, c.valor]),
      ],
    },
    {
      nome: "Inadimplência",
      linhas: [
        ["Aluno", "Origem", "Descrição", "Vencimento", "Dias de atraso", "Valor"],
        ...vencidas
          .map((c) => ({ c, dias: diasEntre(c.vencimento, hoje) }))
          .sort((a, b) => b.dias - a.dias)
          .map(({ c, dias }) => [c.aluno, c.origem, c.descricao, dataBr(c.vencimento), dias, c.valor]),
      ],
    },
    {
      nome: "Por plano",
      linhas: [
        ["Plano", "Mensalidades do mês", "Valor", "Recebido", "Em aberto"],
        ...ordenarPorValor(porPlano).map(([p, cs]) => [
          p,
          cs.length,
          soma(cs),
          soma(cs.filter((c) => PAGO.includes(c.status))),
          soma(cs.filter((c) => EM_ABERTO.includes(c.status))),
        ]),
      ],
    },
  ];
}
