import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { comandoTerminou, equipamentosDeGestao, resumoResultado, situacaoGateway, tempoDesde } from "./gateway";

const agora = new Date("2026-09-23T15:00:00-03:00");
const antes = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();

describe("situacaoGateway — espelho de public.situacao_gateway()", () => {
  it("Gateway 1.0: três minutos sem telemetria é queda, e o estado reportado vale enquanto ele fala", () => {
    expect(situacaoGateway(null, antes(1), "online", agora)).toBe("online");
    expect(situacaoGateway(null, antes(1), "contingencia", agora)).toBe("contingencia");
    expect(situacaoGateway(null, antes(2.9), "online", agora)).toBe("online");
    expect(situacaoGateway(null, antes(3.1), "online", agora)).toBe("offline");
    // Contingência reportada há 10 min não é contingência: é silêncio.
    expect(situacaoGateway(null, antes(10), "contingencia", agora)).toBe("offline");
  });

  it("Gateway anterior (sem telemetria): 15 minutos sem sinal", () => {
    expect(situacaoGateway(null, null, null, agora)).toBe("nunca_conectou");
    expect(situacaoGateway(antes(14), null, null, agora)).toBe("online");
    expect(situacaoGateway(antes(16), null, null, agora)).toBe("offline");
  });

  it("os limites são os mesmos da função do banco", () => {
    const sql = readFileSync("supabase/migrations/20261244010000_telemetria_comandos_gateway.sql", "utf8");
    const funcao = sql.slice(sql.indexOf("function public.situacao_gateway"), sql.indexOf("-- ── Telemetria"));
    expect(funcao).toContain("interval '3 minutes'");
    expect(funcao).toContain("interval '15 minutes'");
  });
});

describe("apoio do painel", () => {
  it("ordem terminada é a que não vai mudar mais", () => {
    expect(["concluido", "falhou", "expirado"].every(comandoTerminou)).toBe(true);
    expect(["pendente", "entregue"].some(comandoTerminou)).toBe(false);
  });

  it("tempo desde, em palavras", () => {
    expect(tempoDesde(null, agora)).toBe("nunca");
    expect(tempoDesde(antes(0.2), agora)).toBe("agora");
    expect(tempoDesde(antes(7), agora)).toBe("há 7 min");
    expect(tempoDesde(antes(180), agora)).toBe("há 3 h");
    expect(tempoDesde(antes(60 * 24 * 3), agora)).toBe("há 3 dias");
  });

  it("resultado em uma frase, com a cópia que falhou em destaque", () => {
    expect(resumoResultado("cadastrar_digital", { equipamento: "Entrada", replicado_em: ["Saída"], falhou_em: [] })).toBe(
      "Digital cadastrada em Entrada e copiada para Saída."
    );
    expect(
      resumoResultado("cadastrar_cartao", {
        equipamento: "Entrada",
        replicado_em: [],
        falhou_em: [{ equipamento: "Saída", erro: "memória cheia" }],
      })
    ).toBe("Cartão cadastrado em Entrada. Não foi possível copiar para: Saída — repita o cadastro.");
    expect(resumoResultado("enviar_logs", { enviados: 0 })).toBe("Não havia acesso guardado para enviar.");
    expect(resumoResultado("sincronizar_completo", { total: 6 })).toBe("Cadastro do Gateway atualizado: 6 aluno(s).");
    expect(resumoResultado("desconhecido", null)).toBe("Concluído.");
  });

  it("equipamentos de gestão saem da telemetria pelo tipo, e lixo não quebra", () => {
    expect(
      equipamentosDeGestao([
        { nome: "Entrada", tipo: "controlid-gestao", visto_em: null },
        { nome: "Control iD 935107", tipo: "controlid", visto_em: "x" },
        null,
        "texto",
      ])
    ).toEqual(["Entrada"]);
    expect(equipamentosDeGestao(null)).toEqual([]);
  });
});
