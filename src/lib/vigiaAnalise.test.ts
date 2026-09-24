import { describe, it, expect } from "vitest";
import {
  CAUSAS,
  FERRAMENTAS,
  classificarAcao,
  esquemaAnalise,
  interpretarResposta,
  montarPedido,
  validarQuadro,
  type Quadro,
} from "../../supabase/functions/_shared/vigiaAnalise";

// Formato de public.vigia_quadro() — o mesmo que o banco gerou no teste da
// migration (20261272010000), reduzido.
const quadro = (): Quadro => ({
  hora_local: 5,
  dia_semana: 4,
  plataforma: { gateways: 4, gateways_no_ar: 1, academias_com_gateway: 1 },
  academias: [{ academia: "A1", gateways: 4, gateways_no_ar: 1 }],
  anomalias: [
    { id: 1, tipo: "gateway_sem_sinal", academia: "A1", gateway: "G1", minutos: 25, dentro_do_horario: true },
    { id: 2, tipo: "gateway_sem_sinal", academia: "A1", gateway: "G2", minutos: 24, dentro_do_horario: true },
    { id: 3, tipo: "rotina_falhou", rotina: "arke-alerta-catracas", repetivel: true, classe_erro: "conexao", minutos: 0 },
    { id: 4, tipo: "rotina_falhou", rotina: "arke-lembrete-onboarding", repetivel: false, classe_erro: "envio_email" },
    { id: 5, tipo: "webhook_nao_processado", evento: "PAYMENT_CONFIRMED", quantidade: 1 },
    { id: 6, tipo: "gateway_sincronizacao_atrasada", academia: "A1", gateway: "G3", minutos: 30 },
  ],
  vigia: [{ regra: "rotina_repetivel_falhou", rotina: "arke-alerta-catracas" }],
});

const respostaDoModelo = (input: unknown) => ({
  output: { message: { content: [{ toolUse: { name: "registrar_analise", input } }] } },
});

describe("validarQuadro — só passa o que está na lista", () => {
  it("aceita o quadro no formato do banco", () => {
    expect(validarQuadro(quadro()).ok).toBe(true);
  });

  // Sujar o quadro de propósito exige sair do tipo — é o que o banco (ou um
  // atalho futuro) faria sem o compilador ver.
  type Solto = Record<string, unknown>;
  const an = (q: Quadro, i: number) => q.anomalias[i] as unknown as Solto;
  it.each<[string, (q: Quadro) => void]>([
    ["campo a mais numa anomalia", (q) => (an(q, 0).detalhe = "internet caiu")],
    ["mensagem de erro em texto", (q) => (an(q, 2).erro = "TypeError: fetch failed")],
    ["nome no lugar do pseudônimo", (q) => (an(q, 0).gateway = "Recepção")],
    ["id do banco no lugar do pseudônimo", (q) => (an(q, 0).academia = "4b836da5-a620-4554-9e70-2dce4506e731")],
    ["e-mail no nome da rotina", (q) => (an(q, 2).rotina = "fulano@exemplo.com")],
    ["CPF como tipo de evento", (q) => (an(q, 4).evento = "12345678909")],
    ["tipo de anomalia desconhecido", (q) => (an(q, 0).tipo = "aluno_sumiu")],
    ["classe de erro inventada", (q) => (an(q, 2).classe_erro = "Fulano quebrou")],
    ["número negativo", (q) => (an(q, 0).minutos = -1)],
    ["texto num campo numérico", (q) => (an(q, 0).minutos = "25")],
    ["campo novo no topo", (q) => ((q as unknown as Solto).observacao = "livre")],
    ["campo novo na academia", (q) => ((q.academias[0] as unknown as Solto).nome = "Academia X")],
    ["objeto aninhado", (q) => (an(q, 0).quantidade = { valor: 1 })],
  ])("recusa %s", (_nome, sujar) => {
    const q = quadro();
    sujar(q);
    expect(validarQuadro(q).ok).toBe(false);
  });

  it("recusa lista grande demais e quadro vazio", () => {
    const grande = quadro();
    grande.anomalias = Array.from({ length: 61 }, (_, i) => ({ id: i + 1, tipo: "banco_capacidade" as const, percentual: 90 }));
    expect(validarQuadro(grande).ok).toBe(false);
    expect(validarQuadro({ ...quadro(), anomalias: [] }).ok).toBe(false);
  });

  it("o pedido ao modelo leva só o quadro e o roteiro fixo", () => {
    const pedido = montarPedido(quadro());
    const enviado = pedido.messages[0].content[0].text;
    expect(enviado).toBe(`Quadro atual:\n${JSON.stringify(quadro())}`);
    expect(pedido.toolConfig.toolChoice).toEqual({ tool: { name: "registrar_analise" } });
  });
});

describe("catálogo de ferramentas", () => {
  it("o esquema oferece exatamente o catálogo e as causas", () => {
    const props = esquemaAnalise().inputSchema.json.properties;
    expect(props.acoes.items.properties.ferramenta.enum).toEqual(Object.keys(FERRAMENTAS));
    expect(props.causa_provavel.enum).toEqual([...CAUSAS]);
  });

  it("não oferece o que nunca pode rodar", () => {
    const nomes = Object.keys(FERRAMENTAS).join(" ");
    for (const proibida of ["liberar", "limpar", "apagar", "excluir", "situacao", "sql"]) {
      expect(nomes).not.toContain(proibida);
    }
  });

  it("a classe vem do catálogo, e rodar rotina de novo depende de ela ser repetível", () => {
    const q = quadro();
    expect(classificarAcao("sincronizar_gateway", "G3", q)).toEqual({ classe: "sozinho" });
    expect(classificarAcao("reexecutar_rotina", "arke-alerta-catracas", q)).toEqual({ classe: "sozinho" });
    expect(classificarAcao("reexecutar_rotina", "arke-lembrete-onboarding", q)).toEqual({ classe: "aprovacao" });
    expect(classificarAcao("reprocessar_evento_asaas", "PAYMENT_CONFIRMED", q)).toEqual({ classe: "aprovacao" });
    expect(classificarAcao("acionar_academia", "A1", q)).toEqual({ classe: "humano" });
    expect(classificarAcao("reconferir_asaas", "plataforma", q)).toEqual({ classe: "sozinho" });
  });

  it("ferramenta fora da lista ou alvo fora do quadro é recusado", () => {
    const q = quadro();
    expect(classificarAcao("liberar_catraca", "G1", q)).toEqual({ classe: null, recusada: "fora_do_catalogo" });
    expect(classificarAcao("sincronizar_gateway", "G9", q)).toEqual({ classe: null, recusada: "alvo_inexistente" });
    expect(classificarAcao("sincronizar_gateway", "A1", q)).toEqual({ classe: null, recusada: "alvo_inexistente" });
    expect(classificarAcao("reexecutar_rotina", "arke-briefing-semanal", q)).toEqual({ classe: null, recusada: "alvo_inexistente" });
    expect(classificarAcao("reconferir_asaas", "G1", q)).toEqual({ classe: null, recusada: "alvo_inexistente" });
  });

  it("ordem a Gateway sem sinal é recusada — ela não chegaria (achado do simulado)", () => {
    const q = quadro();
    for (const f of ["reenviar_acessos_gateway", "pedir_diagnostico_gateway", "sincronizar_gateway", "reiniciar_gateway"]) {
      expect(classificarAcao(f, "G1", q), f).toEqual({ classe: null, recusada: "alvo_sem_sinal" });
    }
    // Falar com a academia do Gateway sem sinal continua sendo a ação certa.
    expect(classificarAcao("acionar_academia", "A1", q)).toEqual({ classe: "humano" });
    // Gateway no ar recebe ordem normalmente.
    const noAr = { ...q, anomalias: [{ id: 1, tipo: "gateway_fila_parada" as const, gateway: "G3", academia: "A1", fila_offline: 9 }] };
    expect(classificarAcao("reenviar_acessos_gateway", "G3", noAr)).toEqual({ classe: "sozinho" });
  });

  it("a mesma ordem para 3 Gateways ou mais é segurada pelo freio (achado do simulado)", () => {
    const nuvemLenta: Quadro = {
      ...quadro(),
      anomalias: ["G1", "G2", "G3", "G4"].map((g, i) => ({ id: i + 1, tipo: "gateway_contingencia" as const, gateway: g, academia: `A${i + 1}`, minutos: 15 })),
    };
    const r = interpretarResposta(
      respostaDoModelo({
        diagnostico: "Nuvem lenta: quatro academias em contingência.",
        causa_provavel: "nuvem_arke",
        gravidade: "alta",
        confianca: 88,
        acoes: [
          ...["G1", "G2", "G3"].map((g) => ({ ferramenta: "sincronizar_gateway", alvo: g, justificativa: "x" })),
          ...["G1", "G2"].map((g) => ({ ferramenta: "reenviar_acessos_gateway", alvo: g, justificativa: "x" })),
          { ferramenta: "acionar_suporte_arkefit", alvo: "plataforma", justificativa: "x" },
        ],
      }),
      nuvemLenta,
    );
    expect(r.ok && r.analise.acoes.map((a) => a.recusada ?? a.classe)).toEqual([
      "freio_falha_geral",
      "freio_falha_geral",
      "freio_falha_geral",
      // Duas não chegam ao limite: seguem com a classe do catálogo.
      "sozinho",
      "sozinho",
      "humano",
    ]);
  });
});

describe("interpretarResposta", () => {
  it("lê a análise e classifica cada ação pelo catálogo", () => {
    const r = interpretarResposta(
      respostaDoModelo({
        diagnostico: "G1 e G2 da A1 caíram juntos: rede local.",
        causa_provavel: "internet_da_academia",
        gravidade: "alta",
        confianca: 85,
        anomalias_relacionadas: [1, 2, 99],
        acoes: [
          { ferramenta: "acionar_academia", alvo: "A1", justificativa: "Duas catracas caíram juntas." },
          { ferramenta: "liberar_catraca", alvo: "G1", justificativa: "Deixar entrar." },
          // O modelo não escolhe a classe: um "classe" vindo dele é ignorado.
          { ferramenta: "reexecutar_rotina", alvo: "arke-lembrete-onboarding", justificativa: "x", classe: "sozinho" },
        ],
      }),
      quadro(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.analise.causa_provavel).toBe("internet_da_academia");
    expect(r.analise.confianca).toBe(85);
    expect(r.analise.anomalias_relacionadas).toEqual([1, 2]);
    expect(r.analise.acoes.map((a) => [a.ferramenta, a.classe, a.recusada])).toEqual([
      ["acionar_academia", "humano", undefined],
      ["liberar_catraca", null, "fora_do_catalogo"],
      ["reexecutar_rotina", "aprovacao", undefined],
    ]);
  });

  it("valores fora do esperado viram o neutro, e sem ferramenta é resposta inválida", () => {
    const r = interpretarResposta(
      respostaDoModelo({ diagnostico: "ok", causa_provavel: "marte", gravidade: "enorme", confianca: 140, acoes: "nada" }),
      quadro(),
    );
    expect(r.ok && [r.analise.causa_provavel, r.analise.gravidade, r.analise.confianca, r.analise.acoes]).toEqual([
      "indeterminada",
      null,
      null,
      [],
    ]);
    expect(interpretarResposta({ output: { message: { content: [{ text: "oi" }] } } }, quadro()).ok).toBe(false);
    expect(interpretarResposta(respostaDoModelo({ diagnostico: "  " }), quadro()).ok).toBe(false);
  });
});
