import { describe, it, expect } from "vitest";
import { montarEmailResumo, linhaRegra, linhaAcao, type Resumo } from "../../supabase/functions/vigia-resumo/email";

// Formato de public.vigia_resumo_interno(24).
const regra = (codigo: string, nivel: number, extra: Partial<Resumo["regras"][number]> = {}) => ({
  codigo,
  nivel,
  titulo: `Regra ${codigo}`,
  acao: "Pedir ao Gateway a sincronização completa",
  modo: "sombra",
  deteccoes: 0,
  teria_agido: 0,
  com_retentativa: 0,
  sumiram_antes: 0,
  mediana_min_sumiram: null,
  persistiram: 0,
  escalariam: 0,
  freios: 0,
  abertas: 0,
  ...extra,
});

const resumo = (extra: Partial<Resumo> = {}): Resumo => ({
  ativo: true,
  sombra_desde: "2026-09-24T12:00:00Z",
  dia: 3,
  dias_avaliacao: 14,
  janela_horas: 24,
  varreduras: 288,
  regras: [
    regra("gateway_sincronizacao_atrasada", 1, { deteccoes: 2, teria_agido: 1, sumiram_antes: 1, mediana_min_sumiram: 3.5 }),
    regra("assinatura_orfa", 2),
  ],
  analises: {
    total: 1,
    ok: 1,
    indisponiveis: 0,
    recusadas: 0,
    invalidas: 0,
    acoes_sozinho: 1,
    acoes_aprovacao: 0,
    acoes_humano: 1,
    acoes_recusadas: 0,
    lista: [
      {
        id: 1,
        criada_em: "2026-09-26T13:10:00Z",
        status: "ok",
        modelo: "global.anthropic.claude-sonnet-4-6",
        diagnostico: "Recepção e Sala 2 da Academia Tietê caíram juntas: rede local.",
        causa_provavel: "internet_da_academia",
        gravidade: "alta",
        confianca: 85,
        anomalias: 2,
        latencia_ms: 9000,
        motivo: null,
        acoes: [
          {
            ferramenta: "acionar_academia",
            alvo: "A1",
            alvo_nome: "Academia Tietê",
            justificativa: "Duas catracas caíram juntas.",
            classe: "humano",
          },
          {
            ferramenta: "pedir_diagnostico_gateway",
            alvo: "G1",
            alvo_nome: "Recepção (Academia Tietê)",
            justificativa: "",
            classe: "sozinho",
          },
        ],
      },
    ],
  },
  total: { deteccoes: 5, teria_agido: 3, sumiram_antes: 2, escalariam: 0, analises: 4 },
  ...extra,
});

describe("resumo diário do Vigia", () => {
  it("diz que nada foi executado, o dia do período e o que teria feito", () => {
    const m = montarEmailResumo(resumo(), "https://www.arkefit.com.br");
    expect(m.assunto).toBe("[ArkeFit] Vigia · modo sombra, dia 3 de 14: 2 ocorrências, 1 análise");
    expect(m.texto).toContain("Modo sombra: nada foi executado");
    expect(m.texto).toContain("288 varreduras");
    expect(m.texto).toContain("teria agido em 1");
    expect(m.texto).toContain("1 sumiu antes da hora de agir, mediana de 3,5 min");
    expect(m.texto).toContain("Falar com a academia em Academia Tietê — pede uma pessoa. Duas catracas caíram juntas.");
    expect(m.texto).toContain("Pedir diagnóstico ao Gateway em Recepção (Academia Tietê) — faria sozinho");
    expect(m.texto).toContain("confiança declarada 85%");
    expect(m.html).toContain("https://www.arkefit.com.br/#/superadmin/vigia");
    // Regra sem atividade fica de fora da lista.
    expect(m.texto).not.toContain("Regra assinatura_orfa");
  });

  it("dia calmo também sai — é o que distingue um dia sem problema de um Vigia parado", () => {
    const calmo = resumo({
      regras: [regra("gateway_sincronizacao_atrasada", 1)],
      analises: { ...resumo().analises, total: 0, ok: 0, lista: [] },
    });
    const m = montarEmailResumo(calmo, "https://x");
    expect(m.assunto).toBe("[ArkeFit] Vigia · modo sombra, dia 3 de 14: sem ocorrências");
    expect(m.texto).toContain("Nenhuma regra disparou.");
    expect(m.texto).toContain("Nenhuma análise");
  });

  it("depois dos 14 dias, avisa que a avaliação terminou", () => {
    const m = montarEmailResumo(resumo({ dia: 15 }), "https://x");
    expect(m.assunto).toBe("[ArkeFit] Vigia · avaliação do modo sombra concluída (dia 15)");
    expect(m.texto).toContain("terminou em 08/10");
  });

  it("escapa o que vem do banco no HTML", () => {
    const r = resumo();
    r.analises.lista[0].diagnostico = "<script>x</script>";
    expect(montarEmailResumo(r, "https://x").html).not.toContain("<script>");
  });

  it("em execução: conta o que fez, o que espera aprovação, e deixa de falar em sombra", () => {
    const r = resumo({
      regras: [
        regra("gateway_sincronizacao_atrasada", 1, { modo: "automatica", deteccoes: 1, teria_agido: 1, escalariam: 1 }),
        regra("assinatura_orfa", 2, { modo: "aprovacao", deteccoes: 1, teria_agido: 1 }),
      ],
      pendentes: [
        {
          origem: "regra",
          id: 9,
          indice: null,
          desde: "2026-09-26T13:00:00Z",
          ferramenta: "cancelar_assinatura_orfa",
          alvo_nome: "Assinatura ativa no Asaas sem registro no banco (metodo:x)",
          descricao: null,
          titulo: "Assinatura cobrando no Asaas sem registro no banco",
        },
      ],
      executadas: {
        automaticas: 2,
        aprovadas: 1,
        dispensadas: 0,
        erros: 1,
        lista: [
          {
            id: 1,
            criada_em: "2026-09-26T13:05:00Z",
            origem: "regra",
            ferramenta: "sincronizar_gateway",
            alvo_nome: "Recepção (Tietê)",
            forma: "automatica",
            resultado: "ok",
            detalhe: "Ordem na fila do Gateway.",
            decidido_por: null,
            comando_status: "concluido",
            comando_erro: null,
          },
          {
            id: 2,
            criada_em: "2026-09-26T13:06:00Z",
            origem: "regra",
            ferramenta: "reexecutar_rotina",
            alvo_nome: "Rotina arke-vigia-resumo falhou",
            forma: "aprovada",
            resultado: "erro",
            detalhe: "Rotina não encontrada.",
            decidido_por: "andre@exemplo.com",
            comando_status: null,
            comando_erro: null,
          },
        ],
      },
      total: { ...resumo().total, executadas: 7 },
    });
    const m = montarEmailResumo(r, "https://x");
    expect(m.assunto).toBe("[ArkeFit] Vigia · resumo do dia: 3 ações executadas, 1 aguardando aprovação");
    expect(m.texto).not.toContain("Modo sombra");
    expect(m.texto).toContain("AGUARDANDO APROVAÇÃO");
    expect(m.texto).toContain("Cancelar assinatura órfã — Assinatura cobrando no Asaas sem registro no banco");
    expect(m.texto).toContain("2 sozinho, 1 aprovada(s), 0 dispensada(s), 1 com erro.");
    expect(m.texto).toContain("Sincronizar o Gateway (Recepção (Tietê)) · sozinho — ordem concluido");
    expect(m.texto).toContain("aprovada por andre@exemplo.com — falhou: Rotina não encontrada.");
    expect(m.texto).toContain("agiu em 1");
    expect(m.texto).toContain("1 foi para uma pessoa");
    expect(m.texto).toContain("pediu aprovação em 1");
    expect(m.texto).toContain("7 ações executadas");
  });

  it("nível 2 pede aprovação, e ação recusada diz por quê", () => {
    expect(linhaRegra(regra("assinatura_orfa", 2, { deteccoes: 1, teria_agido: 1 }))).toContain("teria pedido aprovação em 1");
    expect(
      linhaAcao({ ferramenta: "liberar_catraca", alvo: "G1", alvo_nome: "G1", justificativa: "", classe: null, recusada: "fora_do_catalogo" }),
    ).toBe("liberar_catraca em G1 — recusada: fora da lista de ferramentas");
  });
});
