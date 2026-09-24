import { describe, it, expect } from "vitest";
import { montarEmailArkeFit, montarEmailGestor, type ItemCatraca } from "../../supabase/functions/alertar-catracas/email";

const SITE = "https://www.arkefit.com.br";

const item = (parcial: Partial<ItemCatraca>): ItemCatraca => ({
  catraca_id: "c1",
  organization_id: "o1",
  academia: "Tietê Fitness",
  catraca: "Entrada",
  tipo: "novo",
  situacao: "catraca_offline",
  sem_sinal_desde: "2026-09-23T17:32:00Z",
  ...parcial,
});

describe("aviso de catraca fora do ar", () => {
  it("gestor: diz qual catraca, desde quando e o que conferir na recepção — sem jargão", () => {
    const { assunto, texto, html } = montarEmailGestor("Tietê Fitness", [item({})], SITE);
    expect(assunto).toBe("A catraca da Tietê Fitness está sem sinal");
    // 17:32 UTC = 14:32 em Brasília.
    expect(texto).toContain("Entrada: desde 23/09, 14:32");
    expect(texto).toContain("O computador da recepção, onde o programa da ArkeFit roda, está ligado?");
    expect(texto).toContain("/#/admin/catracas");
    expect(texto).not.toMatch(/telemetria|Gateway Local 1\.0|catraca:/);
    expect(html).toContain("A ArkeFit também foi avisada.");
  });

  it("gestor: lembrete e volta", () => {
    expect(montarEmailGestor("Tietê Fitness", [item({ tipo: "lembrete" })], SITE).texto).toContain("(ainda sem sinal)");
    const volta = montarEmailGestor("Tietê Fitness", [item({ tipo: "recuperou", situacao: "ok", sem_sinal_desde: null })], SITE);
    expect(volta.assunto).toBe("A catraca da Tietê Fitness voltou a funcionar");
    expect(volta.texto).toContain("Voltou a funcionar: Entrada.");
  });

  it("ArkeFit: todas as academias num e-mail, com o link de Equipamentos", () => {
    const { assunto, texto } = montarEmailArkeFit(
      [item({}), item({ catraca_id: "c2", organization_id: "o2", academia: "Academia Dois", catraca: "Saída", tipo: "lembrete" })],
      SITE
    );
    expect(assunto).toBe("[ArkeFit] 2 catraca(s) sem sinal");
    expect(texto).toContain("Tietê Fitness · Entrada sem sinal desde 23/09, 14:32");
    expect(texto).toContain("Ainda: Academia Dois · Saída");
    expect(texto).toContain("/#/superadmin/equipamentos");
    expect(texto).toContain("O gestor de cada academia também foi avisado.");
  });

  it("ArkeFit: só volta, e catraca desativada no meio do caminho", () => {
    const { assunto, texto } = montarEmailArkeFit(
      [item({ tipo: "recuperou", situacao: "ok" }), item({ catraca_id: "c2", catraca: "Saída", tipo: "recuperou", situacao: "desativada" })],
      SITE
    );
    expect(assunto).toBe("[ArkeFit] 2 catraca(s) de volta");
    expect(texto).toContain("Entrada voltou a falar com a nuvem");
    expect(texto).toContain("Saída foi desativada");
  });

  it("nome com HTML não vira HTML no e-mail", () => {
    const { html } = montarEmailGestor("<b>X</b>", [item({ catraca: "<i>Y</i>" })], SITE);
    expect(html).not.toContain("<i>Y</i>");
    expect(html).toContain("&lt;i&gt;Y&lt;/i&gt;");
    expect(montarEmailArkeFit([item({ academia: "<b>X</b>" })], SITE).html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
