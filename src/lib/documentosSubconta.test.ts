import { afterEach, describe, expect, it, vi } from "vitest";
import { documentosDaSubconta, grupoPendente } from "../../supabase/functions/asaas-conta-academia/fluxo";
import { grupoPendente as grupoPendenteNaTela } from "./contaAsaas";

/**
 * Os documentos da subconta no formato BaaS: `GET /myAccount/documents`, com
 * a chave da subconta, e o link de envio (`onboardingUrl`) de cada grupo.
 */
afterEach(() => vi.unstubAllGlobals());

describe("documentos da subconta", () => {
  it("lê os grupos, tira o ignorado, e só aceita link https", async () => {
    let chamada = "";
    let chave = "";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      chamada = url;
      chave = String((init.headers as Record<string, string>).access_token);
      return new Response(
        JSON.stringify({
          rejectReasons: null,
          data: [
            { id: "g1", status: "NOT_SENT", type: "IDENTIFICATION", title: "Documento de identidade", responsible: { name: "Sócio" }, onboardingUrl: "https://cadastro.io/abc", onboardingUrlExpirationDate: "2026-10-20 00:00:00" },
            { id: "g2", status: "IGNORED", type: "CUSTOM", title: "Ignorado" },
            { id: "g3", status: "REJECTED", type: "CUSTOM", title: "Extra", description: "Ata de eleição", onboardingUrl: "javascript:alert(1)" },
          ],
        }),
        { status: 200 },
      );
    });
    const r = await documentosDaSubconta("https://api", "$aact_subconta");
    expect(chamada).toBe("https://api/myAccount/documents");
    expect(chave).toBe("$aact_subconta");
    expect(r).toEqual({
      ok: true,
      motivoRecusa: null,
      grupos: [
        { id: "g1", status: "NOT_SENT", tipo: "IDENTIFICATION", titulo: "Documento de identidade", descricao: null, responsavel: "Sócio", link: "https://cadastro.io/abc", linkExpiraEm: "2026-10-20 00:00:00" },
        { id: "g3", status: "REJECTED", tipo: "CUSTOM", titulo: "Extra", descricao: "Ata de eleição", responsavel: null, link: null, linkExpiraEm: null },
      ],
    });
  });

  it("o Asaas fora do ar vira erro, e não lista vazia", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ errors: [{ code: "x", description: "indisponível" }] }), { status: 500 }));
    expect(await documentosDaSubconta("https://api", "k")).toEqual({ ok: false, erro: "Asaas: indisponível" });
  });

  it("pendente é o que pede ação do titular, igual na função e na tela", () => {
    for (const status of ["NOT_SENT", "REJECTED", "PENDING", "APPROVED"]) {
      expect(grupoPendente({ status })).toBe(grupoPendenteNaTela({ status }));
    }
    expect(grupoPendente({ status: "NOT_SENT" })).toBe(true);
    expect(grupoPendente({ status: "PENDING" })).toBe(false);
  });
});
