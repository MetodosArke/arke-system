import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  comandoTerminou,
  equipamentosDeGestao,
  numeroNaoCadastrado,
  resumoResultado,
  situacaoGateway,
  tempoDesde,
  versaoAbaixoDaMinima,
} from "./gateway";

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
    // A Toletus não guarda cadastro: o Gateway diz o que fez, e a frase dele vale.
    expect(resumoResultado("cadastrar_usuario", { equipamentos: [], mensagem: "Número 12 reservado ao aluno." })).toBe(
      "Número 12 reservado ao aluno."
    );
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

  it("número lido aparece só para cartão não cadastrado, e nunca o CPF", () => {
    expect(numeroNaoCadastrado({ resultado: "negado_nao_encontrado", cpf_consultado: "id:3954862189" })).toBe("3954862189");
    expect(numeroNaoCadastrado({ resultado: "negado_nao_encontrado", cpf_consultado: "52998224725" })).toBeNull();
    expect(numeroNaoCadastrado({ resultado: "liberado", cpf_consultado: "id:3954862189" })).toBeNull();
    expect(numeroNaoCadastrado({ resultado: "negado_nao_encontrado", cpf_consultado: "id:" })).toBeNull();
    expect(numeroNaoCadastrado({ resultado: "negado_nao_encontrado", cpf_consultado: null })).toBeNull();
  });
});

describe("versaoAbaixoDaMinima — espelho de versaoAbaixo do Gateway", () => {
  it("compara número a número", () => {
    expect(versaoAbaixoDaMinima("1.6.9", "1.7.0")).toBe(true);
    expect(versaoAbaixoDaMinima("1.9.0", "1.10.0")).toBe(true);
    expect(versaoAbaixoDaMinima("1.10.0", "1.9.0")).toBe(false);
    expect(versaoAbaixoDaMinima("1.7.0", "1.7.0")).toBe(false);
    expect(versaoAbaixoDaMinima("1.8.0", "1.7.0")).toBe(false);
  });

  it("Gateway sem versão é o anterior à 1.0: abaixo de qualquer mínima", () => {
    expect(versaoAbaixoDaMinima(null, "1.7.0")).toBe(true);
  });

  it("sem mínima, ou com versão que não se lê, não acusa", () => {
    expect(versaoAbaixoDaMinima("1.0.0", null)).toBe(false);
    expect(versaoAbaixoDaMinima(null, "")).toBe(false);
    expect(versaoAbaixoDaMinima("teste", "1.7.0")).toBe(false);
  });

  it("dá o mesmo resultado que a função do Gateway", async () => {
    const { versaoAbaixo } = await import("../../packages/gateway/src/versao");
    const casos = [["1.6.9", "1.7.0"], ["1.9.0", "1.10.0"], ["1.10.0", "1.9.0"], ["1.7.0", "1.7.0"], ["2.0.0", "1.7.0"], ["teste", "1.7.0"], ["1.0.0", ""]];
    for (const [v, m] of casos) expect(versaoAbaixoDaMinima(v, m), `${v} / ${m}`).toBe(versaoAbaixo(v, m));
  });
});
