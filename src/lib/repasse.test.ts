import { describe, it, expect } from "vitest";
import { dividirCobranca, repasseArke, resolverRepasse, taxaProcessamento, type RepasseConfig } from "./repasse";

const TAXA = { percentual: 2.99, fixa: 0.49 };
const FIXO_45: RepasseConfig = { tipo: "fixo", valor: 45 };
const PCT_30: RepasseConfig = { tipo: "percentual", valor: 30 };
const NAO_NEGOCIADO: RepasseConfig = { tipo: "fixo", valor: null };

describe("repasse do Método ARKE", () => {
  it("bate com a função do banco nos preços sugeridos", () => {
    // Valores conferidos contra public.arke_taxa_processamento em 21/09/2026.
    expect(taxaProcessamento(39.9, TAXA)).toBe(1.68);
    expect(taxaProcessamento(119, TAXA)).toBe(4.05);
    expect(taxaProcessamento(199, TAXA)).toBe(6.44);
  });

  it("a taxa entra no repasse da ArkeFit, não na parte da academia", () => {
    expect(dividirCobranca(119, FIXO_45, TAXA)).toEqual({
      taxaEstimada: 4.05,
      repasseArke: 49.05,
      liquidoAcademia: 69.95,
      cobreORepasse: true,
      semRepasseNegociado: false,
    });
  });

  it("acompanha o varejo que a academia define: a parte percentual cresce com o valor", () => {
    const sugerido = dividirCobranca(119, FIXO_45, TAXA);
    const maisCaro = dividirCobranca(149, FIXO_45, TAXA);
    expect(maisCaro.taxaEstimada).toBeGreaterThan(sugerido.taxaEstimada);
    // No fixo, o que a ArkeFit retém além da taxa não muda com o varejo.
    expect(maisCaro.repasseArke! - maisCaro.taxaEstimada).toBe(45);
  });

  it("no percentual, a retenção acompanha o valor cobrado", () => {
    // Conferido contra public.repasse_arke em 23/09/2026: 30% de 149 = 44,70
    // mais a taxa de 4,95 = 49,65.
    expect(repasseArke(149, PCT_30, TAXA)).toBe(49.65);
    expect(repasseArke(99, PCT_30, TAXA)).toBe(33.15);
  });

  it("fixo e percentual podem dar quase o mesmo no preço de tabela e divergir fora dele", () => {
    // É o ponto comercial do percentual: acompanha o ticket da academia.
    expect(repasseArke(149, FIXO_45, TAXA)).toBe(49.95);
    expect(repasseArke(149, PCT_30, TAXA)).toBe(49.65);
    expect(repasseArke(299, FIXO_45, TAXA)).toBe(54.43);
    expect(repasseArke(299, PCT_30, TAXA)).toBe(99.13);
  });

  it("valor que não cobre o repasse é sinalizado", () => {
    expect(dividirCobranca(15, { tipo: "fixo", valor: 15 }, TAXA).cobreORepasse).toBe(false);
  });

  it("sem valor digitado não inventa taxa", () => {
    expect(dividirCobranca(0, FIXO_45, TAXA)).toEqual({
      taxaEstimada: 0,
      repasseArke: 45,
      liquidoAcademia: -45,
      cobreORepasse: false,
      semRepasseNegociado: false,
    });
  });

  it("a exceção do nível vence o padrão da academia, e só quando tem valor", () => {
    // Conferido contra public.repasse_arke em 23/09/2026: Elite com exceção
    // fixa de 85 sobre 199 dá 91,44; sem exceção cai no padrão e dá 51,44.
    const padrao: RepasseConfig = { tipo: "fixo", valor: 45 };
    const excecaoElite: RepasseConfig = { tipo: "fixo", valor: 85 };
    expect(repasseArke(199, resolverRepasse(padrao, excecaoElite), TAXA)).toBe(91.44);
    expect(repasseArke(199, resolverRepasse(padrao, null), TAXA)).toBe(51.44);
    // Linha de nível sem exceção gravada não pode suprimir o padrão.
    expect(repasseArke(199, resolverRepasse(padrao, { tipo: "fixo", valor: null }), TAXA)).toBe(51.44);
  });

  it("a exceção do nível basta mesmo sem padrão da academia", () => {
    const semPadrao: RepasseConfig = { tipo: "fixo", valor: null };
    expect(repasseArke(119, resolverRepasse(semPadrao, { tipo: "fixo", valor: 60 }), TAXA)).toBe(64.05);
    expect(repasseArke(119, resolverRepasse(semPadrao, null), TAXA)).toBeNull();
  });

  it("academia sem repasse negociado não vira divisão inventada", () => {
    // Cair num padrão cobraria o aluno com uma divisão que ninguém acordou, e
    // o erro só apareceria no extrato.
    expect(repasseArke(119, NAO_NEGOCIADO, TAXA)).toBeNull();
    const d = dividirCobranca(119, NAO_NEGOCIADO, TAXA);
    expect(d.semRepasseNegociado).toBe(true);
    expect(d.cobreORepasse).toBe(false);
    expect(d.repasseArke).toBeNull();
  });

  it("a taxa nunca fica abaixo do mínimo por cobrança (a taxa fixa do boleto e do PIX)", () => {
    // Os mesmos números que public.arke_taxa_processamento devolveu em
    // 24/09/2026 com mínimo de 1,99. Sem o piso, em R$ 5 a parte da academia
    // (4,36) passava do líquido (4,01) e o Asaas recusava a cobrança.
    const COM_MINIMO = { ...TAXA, minima: 1.99 };
    expect(taxaProcessamento(5, COM_MINIMO)).toBe(1.99);
    expect(taxaProcessamento(30, COM_MINIMO)).toBe(1.99);
    expect(taxaProcessamento(50, COM_MINIMO)).toBe(1.99);
    // Acima de ~R$ 50 o percentual já cobre o mínimo, e nada muda.
    expect(taxaProcessamento(60, COM_MINIMO)).toBe(2.28);
    expect(taxaProcessamento(119, COM_MINIMO)).toBe(4.05);
    expect(taxaProcessamento(0, COM_MINIMO)).toBe(0);
    // Sem mínimo configurado, a regra antiga.
    expect(taxaProcessamento(30, TAXA)).toBe(1.39);
  });
});
