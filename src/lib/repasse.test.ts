import { describe, it, expect } from "vitest";
import { dividirCobranca, taxaProcessamento } from "./repasse";

const TAXA = { percentual: 2.99, fixa: 0.49 };

describe("repasse do Método ARKE", () => {
  it("bate com a função do banco nos preços sugeridos", () => {
    // Valores conferidos contra public.arke_taxa_processamento em 21/09/2026.
    expect(taxaProcessamento(39.9, TAXA)).toBe(1.68);
    expect(taxaProcessamento(119, TAXA)).toBe(4.05);
    expect(taxaProcessamento(199, TAXA)).toBe(6.44);
  });

  it("a taxa entra no repasse da ArkeFit, não na parte da academia", () => {
    expect(dividirCobranca(119, 45, TAXA)).toEqual({
      taxaEstimada: 4.05,
      repasseArke: 49.05,
      liquidoAcademia: 69.95,
      cobreORepasse: true,
    });
  });

  it("acompanha o varejo que a academia define: a parte percentual cresce com o valor", () => {
    const sugerido = dividirCobranca(119, 45, TAXA);
    const maisCaro = dividirCobranca(149, 45, TAXA);
    expect(maisCaro.taxaEstimada).toBeGreaterThan(sugerido.taxaEstimada);
    expect(maisCaro.repasseArke - maisCaro.taxaEstimada).toBe(45);
  });

  it("valor que não cobre o repasse é sinalizado", () => {
    expect(dividirCobranca(15, 15, TAXA).cobreORepasse).toBe(false);
  });

  it("sem valor digitado não inventa taxa", () => {
    expect(dividirCobranca(0, 45, TAXA)).toEqual({ taxaEstimada: 0, repasseArke: 45, liquidoAcademia: -45, cobreORepasse: false });
  });
});
