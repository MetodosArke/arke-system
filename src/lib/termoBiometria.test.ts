import { describe, it, expect } from "vitest";
import { htmlTermoBiometria, TEXTO_TERMO_BIOMETRIA, VERSAO_CONSENTIMENTO_BIOMETRIA } from "./termoBiometria";

describe("termo impresso da digital", () => {
  it("leva a academia, o aluno com CPF, o texto inteiro e a versão", () => {
    const html = htmlTermoBiometria({
      academia: "Tietê Fitness",
      aluno: "Maria da Silva",
      cpf: "12345678909",
      data: new Date("2026-09-23T15:00:00-03:00"),
    });
    expect(html).toContain("Tietê Fitness");
    expect(html).toContain("Maria da Silva");
    expect(html).toContain("123.456.789-09");
    expect(html).toContain(`versão do termo ${VERSAO_CONSENTIMENTO_BIOMETRIA}`);
    expect(html).toContain("23/09/2026");
    for (const p of TEXTO_TERMO_BIOMETRIA) expect(html).toContain(p.replace(/—/g, "—"));
    expect(html).toContain("Assinatura do(a) aluno(a)");
  });

  it("sem CPF deixa a linha para preencher, e nome com HTML não vira HTML", () => {
    const html = htmlTermoBiometria({ academia: "<b>A</b>", aluno: "<script>x</script>" });
    expect(html).toContain("____________________");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
