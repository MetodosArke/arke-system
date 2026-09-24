import { describe, it, expect } from "vitest";
import {
  DESCRICAO_PADRAO,
  TIPOS_COBRANCA_AVULSA,
  VALOR_MAXIMO,
  validarCobrancaAvulsa,
} from "../../supabase/functions/asaas-cobranca-avulsa/fluxo";
import { TIPOS_COBRANCA, situacaoCobranca } from "./cobrancaAvulsa";

const HOJE = "2026-09-24";

describe("validarCobrancaAvulsa (o mesmo código da edge function)", () => {
  it("aceita o pedido e usa a descrição padrão do tipo", () => {
    const r = validarCobrancaAvulsa({ tipo: "taxa_matricula", valor: 80 }, HOJE);
    expect(r).toEqual({ ok: true, pedido: { tipo: "taxa_matricula", descricao: "Taxa de matrícula", valor: 80, vencimento: HOJE } });
  });

  it("aceita valor com vírgula vindo como texto", () => {
    const r = validarCobrancaAvulsa({ tipo: "personal", valor: "120,50", vencimento: "2026-10-01" }, HOJE);
    expect(r.ok && r.pedido.valor).toBe(120.5);
  });

  it.each([
    [{ tipo: "mensalidade", valor: 10 }, "Tipo de cobrança inválido."],
    [{ tipo: "outro", valor: 0 }, "Informe um valor maior que zero."],
    [{ tipo: "outro", valor: -5 }, "Informe um valor maior que zero."],
    [{ tipo: "outro", valor: 4.99 }, "O Asaas só emite cobrança a partir de R$ 5,00."],
    [{ tipo: "outro", valor: 10.555 }, "O valor aceita no máximo duas casas decimais."],
    [{ tipo: "outro", valor: 10, descricao: "ab" }, "A descrição precisa ter entre 3 e 120 caracteres."],
    [{ tipo: "outro", valor: 10, vencimento: "2026-09-23" }, "O vencimento não pode ser no passado."],
    [{ tipo: "outro", valor: 10, vencimento: "2027-09-25" }, "O vencimento pode ser no máximo daqui a um ano."],
    [{ tipo: "outro", valor: 10, vencimento: "24/09/2026" }, "Data de vencimento inválida."],
  ])("recusa %j", (entrada, erro) => {
    expect(validarCobrancaAvulsa(entrada, HOJE)).toEqual({ ok: false, erro });
  });

  it("pega o zero a mais antes de virar fatura", () => {
    const r = validarCobrancaAvulsa({ tipo: "avaliacao_fisica", valor: VALOR_MAXIMO + 1 }, HOJE);
    expect(r.ok).toBe(false);
  });
});

describe("rótulos da tela", () => {
  it("são o espelho dos tipos e descrições da edge function", () => {
    // Se um tipo entrar só de um lado, a tela ofereceria o que o servidor recusa.
    expect(TIPOS_COBRANCA.map((t) => t.valor)).toEqual([...TIPOS_COBRANCA_AVULSA]);
    for (const t of TIPOS_COBRANCA) expect(t.rotulo).toBe(DESCRICAO_PADRAO[t.valor]);
  });
});

describe("situacaoCobranca", () => {
  const c = (x: Partial<Parameters<typeof situacaoCobranca>[0]>) =>
    situacaoCobranca({ status: "pendente", vencimento: HOJE, asaas_payment_id: "pay_1", ...x }, HOJE);

  it("separa emissão não confirmada de cobrança em aberto", () => {
    expect(c({ asaas_payment_id: null })).toBe("emissao_nao_confirmada");
    expect(c({})).toBe("vence_hoje");
    expect(c({ vencimento: "2026-10-01" })).toBe("a_vencer");
  });

  it("chama de vencida a pendente com data passada, antes do aviso do Asaas chegar", () => {
    expect(c({ vencimento: "2026-09-20" })).toBe("vencida");
    expect(c({ status: "atrasado" })).toBe("vencida");
  });

  it("paga, cancelada e estornada vencem o resto", () => {
    expect(c({ status: "confirmado", vencimento: "2026-01-01" })).toBe("paga");
    expect(c({ status: "cancelado", asaas_payment_id: null })).toBe("cancelada");
    expect(c({ status: "estornado" })).toBe("estornada");
  });
});
