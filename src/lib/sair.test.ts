import { beforeEach, describe, expect, it, vi } from "vitest";
import { apagarSessaoGuardada, sair, type PassosDaSaida } from "./sair";

function roteiro(opcoes: { simulacao?: boolean; falhar?: Partial<Record<keyof PassosDaSaida, boolean>> } = {}) {
  const passos: string[] = [];
  let pessoa = opcoes.simulacao ? "simulada" : "ana";
  const falha = (p: keyof PassosDaSaida) => {
    if (opcoes.falhar?.[p]) throw new Error(`falhou ${p}`);
  };
  const p: PassosDaSaida = {
    emSimulacao: () => !!opcoes.simulacao,
    encerrarSimulacao: async () => {
      passos.push("encerrou a simulação");
      falha("encerrarSimulacao");
      pessoa = "arkefit";
    },
    pessoaDaSessao: async () => pessoa,
    esquecerAvisos: async (userId) => {
      passos.push(`esqueceu os avisos de ${userId}`);
      falha("esquecerAvisos");
    },
    encerrarSessao: async () => {
      passos.push("encerrou a sessão");
      falha("encerrarSessao");
    },
    limparAba: () => void passos.push("limpou a aba"),
  };
  return { passos, p };
}

describe("sair", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("apaga os avisos ainda conectado, depois sai, depois limpa a aba", async () => {
    const { passos, p } = roteiro();
    await sair(p);
    expect(passos).toEqual(["esqueceu os avisos de ana", "encerrou a sessão", "limpou a aba"]);
  });

  it("na simulação, volta para a conta da ArkeFit e sai dela também", async () => {
    const { passos, p } = roteiro({ simulacao: true });
    await sair(p);
    expect(passos).toEqual([
      "encerrou a simulação",
      "esqueceu os avisos de arkefit",
      "encerrou a sessão",
      "limpou a aba",
    ]);
  });

  it("a aba é limpa mesmo quando os passos anteriores falham", async () => {
    const { passos, p } = roteiro({
      simulacao: true,
      falhar: { encerrarSimulacao: true, esquecerAvisos: true, encerrarSessao: true },
    });
    await sair(p);
    expect(passos.at(-1)).toBe("limpou a aba");
    expect(passos).toContain("encerrou a sessão");
  });

  it("um navegador que não responde não segura a saída", async () => {
    vi.useFakeTimers();
    try {
      const { passos, p } = roteiro();
      p.esquecerAvisos = () => new Promise(() => {});
      const saida = sair(p, 4000);
      await vi.advanceTimersByTimeAsync(4000);
      await saida;
      expect(passos).toEqual(["encerrou a sessão", "limpou a aba"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("apagarSessaoGuardada", () => {
  it("apaga só a sessão do Supabase, nos dois armazenamentos", () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sb-abc-auth-token", "{}");
    window.localStorage.setItem("gym-theme", "dark");
    window.sessionStorage.setItem("sb-abc-auth-token-code-verifier", "x");
    expect(apagarSessaoGuardada()).toBe(2);
    expect(window.localStorage.getItem("gym-theme")).toBe("dark");
    expect(window.localStorage.getItem("sb-abc-auth-token")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });
});
