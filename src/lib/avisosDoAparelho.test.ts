import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { esquecerAvisosDesteAparelho, type DependenciasAvisos } from "./avisosDoAparelho";

function aparelho(endpoint: string | null) {
  const passos: string[] = [];
  const deps: DependenciasAvisos = {
    inscricaoAtual: async () =>
      endpoint
        ? {
            endpoint,
            unsubscribe: async () => {
              passos.push("cancelou no navegador");
              return true;
            },
          }
        : null,
    apagarLinha: async (userId, e) => {
      passos.push(`apagou ${userId} ${e}`);
    },
  };
  return { passos, deps };
}

describe("esquecerAvisosDesteAparelho", () => {
  it("no Sair, apaga a linha da pessoa e depois cancela no navegador", async () => {
    const { passos, deps } = aparelho("https://push.exemplo/abc");
    await esquecerAvisosDesteAparelho("ana", { cancelarNoNavegador: true }, deps);
    expect(passos).toEqual(["apagou ana https://push.exemplo/abc", "cancelou no navegador"]);
  });

  it("na volta da simulação, apaga só a linha da pessoa simulada e deixa a assinatura da ArkeFit", async () => {
    const { passos, deps } = aparelho("https://push.exemplo/abc");
    await esquecerAvisosDesteAparelho("simulada", { cancelarNoNavegador: false }, deps);
    expect(passos).toEqual(["apagou simulada https://push.exemplo/abc"]);
  });

  it("aparelho sem assinatura não faz nada", async () => {
    const { passos, deps } = aparelho(null);
    await esquecerAvisosDesteAparelho("ana", { cancelarNoNavegador: true }, deps);
    expect(passos).toEqual([]);
  });

  it("se a linha não sair, a assinatura do navegador é cancelada mesmo assim", async () => {
    const { passos, deps } = aparelho("https://push.exemplo/abc");
    deps.apagarLinha = async () => {
      throw new Error("rede");
    };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await esquecerAvisosDesteAparelho("ana", { cancelarNoNavegador: true }, deps);
    expect(passos).toEqual(["cancelou no navegador"]);
    erro.mockRestore();
  });
});
