import { describe, expect, it } from "vitest";
import { MENSAGEM_DA_FALHA, motivoDaFalhaDoPdf } from "./falhaDoPdf";

const erro = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("motivoDaFalhaDoPdf", () => {
  it.each([
    ["Chrome", new TypeError("Failed to fetch dynamically imported module: https://app.arkefit.com.br/assets/pdf-3f9a.js")],
    ["Safari", new TypeError("Importing a module script failed.")],
    ["Firefox", new TypeError("error loading dynamically imported module: https://app.arkefit.com.br/assets/pdf-3f9a.js")],
    ["pdf.js sem o worker", new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module".')],
  ])("aba aberta desde antes de uma publicação (%s) vira versão antiga", (_, e) => {
    expect(motivoDaFalhaDoPdf(e)).toBe("versao_antiga");
  });

  it("PDF com senha e arquivo que não é PDF têm mensagens próprias", () => {
    expect(motivoDaFalhaDoPdf(erro("PasswordException", "No password given"))).toBe("senha");
    expect(motivoDaFalhaDoPdf(erro("InvalidPDFException", "Invalid PDF structure."))).toBe("invalido");
  });

  it("o resto não vira mensagem de senha ou arquivo corrompido", () => {
    expect(motivoDaFalhaDoPdf(new RangeError("Maximum call stack size exceeded"))).toBe("outro");
    expect(motivoDaFalhaDoPdf("qualquer coisa")).toBe("outro");
    expect(motivoDaFalhaDoPdf(undefined)).toBe("outro");
  });

  it("toda falha tem mensagem, e a de versão antiga manda recarregar", () => {
    for (const m of Object.values(MENSAGEM_DA_FALHA)) expect(m.length).toBeGreaterThan(20);
    expect(MENSAGEM_DA_FALHA.versao_antiga).toMatch(/Recarregue/);
  });
});
