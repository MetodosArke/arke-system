import { describe, expect, it, vi } from "vitest";
import { comNovasTentativas, comPrazo, TentativasInterrompidas } from "./tentativas";

const semEsperar = () => {
  const esperas: number[] = [];
  return { esperas, esperar: async (ms: number) => void esperas.push(ms) };
};

describe("comNovasTentativas", () => {
  it("o padrão é duas tentativas: o supabase-js já repete as falhas de rede por baixo", async () => {
    const { esperas, esperar } = semEsperar();
    let chamadas = 0;
    const acao = async () => {
      chamadas++;
      throw new Error("rede");
    };
    await expect(comNovasTentativas(acao, { esperar })).rejects.toThrow("rede");
    expect(chamadas).toBe(2);
    expect(esperas).toEqual([1000]);
  });

  it("dá certo de primeira sem esperar nada", async () => {
    const { esperas, esperar } = semEsperar();
    await expect(comNovasTentativas(async () => "ok", { esperar })).resolves.toBe("ok");
    expect(esperas).toEqual([]);
  });

  it("tenta de novo com espera crescente até dar certo", async () => {
    const { esperas, esperar } = semEsperar();
    let chamadas = 0;
    const acao = async () => {
      chamadas++;
      if (chamadas < 3) throw new Error("rede");
      return chamadas;
    };
    await expect(comNovasTentativas(acao, { esperar, esperaInicialMs: 500, tentativas: 3 })).resolves.toBe(3);
    expect(esperas).toEqual([500, 1000]);
  });

  it("esgotadas as tentativas, lança o último erro", async () => {
    const { esperas, esperar } = semEsperar();
    let n = 0;
    const acao = async () => {
      n++;
      throw new Error(`falha ${n}`);
    };
    await expect(comNovasTentativas(acao, { esperar, tentativas: 4 })).rejects.toThrow("falha 4");
    expect(esperas).toEqual([1000, 2000, 4000]);
  });

  it("para quando a pessoa sai no meio", async () => {
    const { esperar } = semEsperar();
    let seguir = true;
    const acao = vi.fn(async () => {
      seguir = false;
      throw new Error("rede");
    });
    await expect(comNovasTentativas(acao, { esperar, continuar: () => seguir })).rejects.toBeInstanceOf(
      TentativasInterrompidas,
    );
    expect(acao).toHaveBeenCalledTimes(1);
  });
});

describe("comPrazo", () => {
  it("devolve quando a promessa termina antes do prazo", async () => {
    await expect(comPrazo(Promise.resolve(1), 1000)).resolves.toBe("pronto");
  });

  it("engole a falha", async () => {
    await expect(comPrazo(Promise.reject(new Error("x")), 1000)).resolves.toBe("falhou");
  });

  it("segue sem a promessa quando o prazo vence", async () => {
    vi.useFakeTimers();
    try {
      const resultado = comPrazo(new Promise(() => {}), 3000);
      await vi.advanceTimersByTimeAsync(3000);
      await expect(resultado).resolves.toBe("prazo");
    } finally {
      vi.useRealTimers();
    }
  });
});
