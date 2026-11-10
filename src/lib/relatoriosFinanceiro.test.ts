import { describe, expect, it } from "vitest";
import { diasEntre, montarRelatorios, type Cobranca } from "./relatoriosFinanceiro";

const c = (p: Partial<Cobranca>): Cobranca => ({
  origem: "Mensalidade",
  aluno: "Ana",
  descricao: "Mensalidade",
  plano: "Mensal",
  competencia: "2026-11-01",
  vencimento: "2026-11-05",
  valor: 100,
  status: "pendente",
  data_pagamento: null,
  forma_pagamento: null,
  ...p,
});

const aba = (abas: ReturnType<typeof montarRelatorios>, nome: string) => abas.find((a) => a.nome === nome)!.linhas;

describe("relatórios do financeiro", () => {
  const hoje = "2026-11-10";
  const cobrancas = [
    c({ aluno: "Paga", status: "pago", data_pagamento: "2026-11-04", forma_pagamento: "PIX" }),
    c({ aluno: "Paga em outubro", status: "confirmado", competencia: "2026-10-01", data_pagamento: "2026-10-04" }),
    c({ aluno: "Vence depois", vencimento: "2026-11-20", valor: 150 }),
    c({ aluno: "Vence hoje", vencimento: "2026-11-10" }),
    c({ aluno: "Atrasada", status: "atrasado", vencimento: "2026-10-31", plano: "Anual", valor: 80 }),
    c({ aluno: "Cancelada", status: "cancelado", vencimento: "2026-10-01" }),
    c({ origem: "Avulsa", aluno: "Avulsa paga", plano: null, competencia: null, status: "pago", data_pagamento: "2026-11-02", forma_pagamento: "PIX", valor: 50 }),
  ];
  const abas = montarRelatorios(cobrancas, "2026-11", hoje);

  it("recebido é o pago com a data do pagamento no mês, mensalidade e avulsa", () => {
    const linhas = aba(abas, "Recebidas").slice(1);
    expect(linhas.map((l) => l[1])).toEqual(["Avulsa paga", "Paga"]);
  });

  it("a receber vence de hoje em diante; dívida é a vencida antes de hoje, com os dias", () => {
    expect(aba(abas, "A receber").slice(1).map((l) => l[1])).toEqual(["Vence hoje", "Vence depois"]);
    expect(aba(abas, "Inadimplência").slice(1)).toEqual([["Atrasada", "Mensalidade", "Mensalidade", "31/10/2026", 10, 80]]);
  });

  it("o cancelado não é dívida nem a receber", () => {
    const nomes = [...aba(abas, "A receber"), ...aba(abas, "Inadimplência")].map((l) => l[0] ?? l[1]);
    expect(nomes.join(" ")).not.toContain("Cancelada");
  });

  it("o resumo soma por indicador e por forma", () => {
    const resumo = aba(abas, "Resumo");
    expect(resumo).toContainEqual(["Recebido no mês", 2, 150]);
    expect(resumo).toContainEqual(["A receber (a vencer)", 2, 250]);
    expect(resumo).toContainEqual(["Em atraso", 1, 80]);
    expect(resumo).toContainEqual(["PIX", 2, 150]);
  });

  it("por plano conta só as mensalidades da competência do mês", () => {
    expect(aba(abas, "Por plano").slice(1)).toEqual([
      ["Mensal", 4, 450, 100, 250],
      ["Anual", 1, 80, 0, 80],
    ]);
  });

  it("diasEntre conta dias corridos, atravessando o mês", () => {
    expect(diasEntre("2026-10-31", "2026-11-10")).toBe(10);
    expect(diasEntre("2026-11-10", "2026-11-10")).toBe(0);
  });
});
