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

  it("o aluno adulto assina sozinho: nada de responsável no termo", () => {
    const html = htmlTermoBiometria({ academia: "A", aluno: "Maria da Silva" });
    expect(html).not.toContain("Responsável legal");
    expect(html).not.toContain("Assinatura do(a) responsável legal");
  });

  it("o aluno menor leva o nome e a assinatura do responsável, com o mesmo texto", () => {
    const comNome = htmlTermoBiometria({ academia: "A", aluno: "Ana", responsavel: { nome: "Maria <Souza>" } });
    expect(comNome).toContain("Responsável legal (aluno menor de 18 anos):</strong> Maria &lt;Souza&gt;");
    expect(comNome).toContain("Assinatura do(a) aluno(a)");
    expect(comNome).toContain("Assinatura do(a) responsável legal");
    for (const p of TEXTO_TERMO_BIOMETRIA) expect(comNome).toContain(p);

    // Sem o aceite pelo link ainda, o nome fica para preencher à mão.
    const semNome = htmlTermoBiometria({ academia: "A", aluno: "Ana", responsavel: {} });
    expect(semNome).toMatch(/Responsável legal \(aluno menor de 18 anos\):<\/strong> _{20,}/);
  });

  it("sem CPF deixa a linha para preencher, e nome com HTML não vira HTML", () => {
    const html = htmlTermoBiometria({ academia: "<b>A</b>", aluno: "<script>x</script>" });
    expect(html).toContain("____________________");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
