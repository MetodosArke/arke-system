import { describe, it, expect } from "vitest";
import { montarEmailAvisos, type Aviso } from "../../supabase/functions/vigia/email";

// Formato de public.vigia_avisos_pendentes().
const aviso = (tipo: Aviso["tipo"], extra: Partial<Aviso> = {}): Aviso => ({
  id: 1,
  tipo,
  regra: tipo === "aprovacao" ? "assinatura_orfa" : "gateway_fila_parada",
  titulo: tipo === "aprovacao" ? "Assinatura cobrando no Asaas sem registro no banco" : "Acessos guardados no Gateway sem subir",
  acao: tipo === "aprovacao" ? "Cancelar a assinatura no Asaas, com aprovação" : "Pedir ao Gateway que envie os acessos guardados",
  descricao: tipo === "aprovacao" ? "Assinatura ativa no Asaas sem registro no banco (metodo:x)" : "Recepção (Tietê): 12 acesso(s) guardado(s)",
  desde: "2026-09-26T13:00:00Z",
  ...extra,
});

describe("aviso imediato do Vigia", () => {
  it("aprovação pedida: diz que nada acontece sem decisão", () => {
    const m = montarEmailAvisos([aviso("aprovacao")], "https://www.arkefit.com.br");
    expect(m.assunto).toBe("[ArkeFit] Vigia pede aprovação: Assinatura cobrando no Asaas sem registro no banco");
    expect(m.texto).toContain("nada acontece até alguém aprovar ou dispensar");
    expect(m.texto).toContain("Ação proposta: cancelar a assinatura no asaas, com aprovação.");
    expect(m.html).toContain("https://www.arkefit.com.br/#/superadmin/vigia");
  });

  it("esgotou as tentativas: precisa de uma pessoa", () => {
    const m = montarEmailAvisos([aviso("escalada")], "https://x");
    expect(m.assunto).toBe("[ArkeFit] Vigia precisa de uma pessoa: Acessos guardados no Gateway sem subir");
    expect(m.texto).toContain("o Vigia esgotou as tentativas");
    expect(m.texto).toContain('O Vigia tentou "pedir ao gateway que envie os acessos guardados" e o problema continua.');
  });

  it("os dois juntos num e-mail só, e o HTML escapa o que vem do banco", () => {
    const m = montarEmailAvisos([aviso("aprovacao"), aviso("escalada", { id: 2, descricao: "<b>x</b>" })], "https://x");
    expect(m.assunto).toBe("[ArkeFit] Vigia: 1 aprovação(ões) pendente(s) e 1 caso(s) para uma pessoa");
    expect(m.html).not.toContain("<b>x</b>");
  });
});
