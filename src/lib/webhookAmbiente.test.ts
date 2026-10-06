import { describe, expect, it } from "vitest";
import { ambienteDoAviso, pistaDaReferencia } from "../../supabase/functions/asaas-webhook/fluxo";

const ORG = "11111111-2222-3333-4444-555555555555";

describe("pista da referência (o mesmo código do webhook)", () => {
  it("org: e b2b: trazem a organização; avulsa:, a cobrança; metodo: e plano:, o aluno", () => {
    expect(pistaDaReferencia(`org:${ORG}`)).toEqual({ tipo: "organizacao", id: ORG });
    expect(pistaDaReferencia(`b2b:${ORG.toUpperCase()}`)).toEqual({ tipo: "organizacao", id: ORG });
    expect(pistaDaReferencia(`avulsa:${ORG}`)).toEqual({ tipo: "avulsa", id: ORG });
    expect(pistaDaReferencia(`metodo:${ORG}`)).toEqual({ tipo: "aluno", id: ORG });
    expect(pistaDaReferencia(`plano:${ORG}`)).toEqual({ tipo: "aluno", id: ORG });
  });

  it("referência de outro formato não diz nada", () => {
    expect(pistaDaReferencia(`nfse:${ORG}`)).toBeNull();
    expect(pistaDaReferencia("b2b:nao-e-uuid")).toBeNull();
    expect(pistaDaReferencia(`b2b:${ORG}x`)).toBeNull();
    expect(pistaDaReferencia(null)).toBeNull();
    expect(pistaDaReferencia(undefined)).toBeNull();
  });
});

describe("trava de ambiente do webhook", () => {
  it("aviso do sandbox que não acha organização nenhuma é recusado", () => {
    // O caso da auditoria: segredo do sandbox, id de pagamento de produção,
    // sem assinatura nem referência. Antes passava.
    expect(ambienteDoAviso("sandbox", [])).toEqual({ ok: false, resultado: "ambiente_incompativel:sandbox" });
  });

  it("aviso do sandbox só toca organização em trial", () => {
    expect(ambienteDoAviso("sandbox", ["trial"])).toEqual({ ok: true });
    expect(ambienteDoAviso("sandbox", ["trial", "trial"])).toEqual({ ok: true });
    expect(ambienteDoAviso("sandbox", ["ativo"]).ok).toBe(false);
  });

  it("aviso do sandbox que alcança uma organização real junto com a de trial é recusado", () => {
    // A assinatura aponta a academia de homologação, mas o id de pagamento é de
    // uma cobrança de produção: a cobrança real não pode ser tocada.
    expect(ambienteDoAviso("sandbox", ["trial", "ativo"]).ok).toBe(false);
  });

  it("organização apontada que não existe não conta como homologação", () => {
    expect(ambienteDoAviso("sandbox", [null]).ok).toBe(false);
    expect(ambienteDoAviso("producao", [null])).toEqual({ ok: true });
  });

  it("aviso de produção não toca organização em trial", () => {
    expect(ambienteDoAviso("producao", ["trial"])).toEqual({ ok: false, resultado: "ambiente_incompativel:producao" });
    expect(ambienteDoAviso("producao", ["ativo", "trial"]).ok).toBe(false);
    expect(ambienteDoAviso("producao", ["ativo"])).toEqual({ ok: true });
  });

  it("aviso de produção sem organização segue, para terminar como sem correspondência", () => {
    expect(ambienteDoAviso("producao", [])).toEqual({ ok: true });
  });
});
