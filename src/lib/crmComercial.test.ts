import { describe, expect, it } from "vitest";
import {
  acharDuplicado,
  combinaBusca,
  FORMULARIO_VAZIO,
  leticiaCuidando,
  motivoSemAcionar,
  normalizarTelefone,
  numerosDoPipeline,
  tempoNaEtapa,
  validarLead,
} from "./crmComercial";

describe("validarLead", () => {
  const base = { ...FORMULARIO_VAZIO, academia: "  Academia   Forte ", telefone: "+55 (11) 98888-7777" };

  it("limpa e normaliza o que vai ao banco", () => {
    const r = validarLead({ ...base, email: " Dono@Forte.COM ", uf: "sp", nome: "" });
    expect(r).toEqual({
      ok: true,
      dados: expect.objectContaining({
        academia: "Academia Forte",
        telefone: "11988887777",
        email: "dono@forte.com",
        uf: "SP",
        nome: null,
        origem: "whatsapp",
      }),
    });
  });

  it("exige a academia e um jeito de falar com ela", () => {
    expect(validarLead({ ...base, academia: "" })).toMatchObject({ ok: false, erro: expect.stringContaining("academia") });
    expect(validarLead({ ...base, telefone: "", email: "" })).toMatchObject({ ok: false, erro: expect.stringContaining("WhatsApp ou o e-mail") });
    expect(validarLead({ ...base, telefone: "", email: "so@email.com" }).ok).toBe(true);
  });

  it("recusa telefone sem DDD, e-mail torto e UF errada", () => {
    expect(validarLead({ ...base, telefone: "98888777" })).toMatchObject({ ok: false });
    expect(validarLead({ ...base, email: "dono@forte" })).toMatchObject({ ok: false, erro: "Confira o e-mail." });
    expect(validarLead({ ...base, uf: "São" })).toMatchObject({ ok: false });
  });

  it("não deixa anotar um contato de site à mão", () => {
    expect(validarLead({ ...base, origem: "site" })).toMatchObject({ ok: false });
  });

  it("na edição de um contato do site, o canal vem fixo e continua site", () => {
    const r = validarLead({ ...base, origem: "whatsapp" }, "site");
    expect(r.ok && r.dados.origem).toBe("site");
  });

  it("prospecção exige dizer onde o contato foi achado", () => {
    expect(validarLead({ ...base, origem: "prospeccao" })).toMatchObject({ ok: false, erro: expect.stringContaining("onde encontrou") });
    expect(validarLead({ ...base, origem: "prospeccao", origem_detalhe: "Google Maps" }).ok).toBe(true);
  });
});

describe("normalizarTelefone", () => {
  it.each([
    ["(11) 98888-7777", "11988887777"],
    ["+55 11 98888-7777", "11988887777"],
    ["5511988887777", "11988887777"],
    ["11 3333-4444", "1133334444"],
  ])("%s → %s", (entrada, saida) => expect(normalizarTelefone(entrada)).toBe(saida));
});

describe("acharDuplicado", () => {
  const existentes = [
    { id: "1", academia: "Forte", telefone: "5511988887777", email: "dono@forte.com", status: "novo" },
    { id: "2", academia: "Leve", telefone: null, email: "oi@leve.com", status: "ganho" },
  ];

  it("acha pelo fim do telefone, com ou sem o 55", () => {
    expect(acharDuplicado({ telefone: "11988887777", email: null }, existentes)?.id).toBe("1");
  });

  it("acha pelo e-mail sem diferenciar maiúsculas", () => {
    expect(acharDuplicado({ telefone: null, email: "OI@leve.com" }, existentes)?.id).toBe("2");
  });

  it("não acusa o próprio contato em edição, nem telefone curto", () => {
    expect(acharDuplicado({ telefone: "11988887777", email: null }, existentes, "1")).toBeNull();
    expect(acharDuplicado({ telefone: "7777", email: null }, existentes)).toBeNull();
  });
});

describe("Letícia no cartão", () => {
  const ligada = { ativo: true, outrasOrigens: true };
  const zap = { origem: "whatsapp", status: "novo", email: "a@b.com", agente_acionado_em: null, agente_parou_em: null };

  it("pode acionar um contato de WhatsApp em Novos com e-mail", () => {
    expect(motivoSemAcionar(zap, ligada)).toBeNull();
  });

  it("diz o que falta em cada caso, na ordem das recusas do banco", () => {
    expect(motivoSemAcionar({ ...zap, origem: "site" }, ligada)).toContain("sozinho");
    expect(motivoSemAcionar({ ...zap, agente_acionado_em: "2026-09-30T10:00:00Z" }, ligada)).toContain("já foi acionada");
    expect(motivoSemAcionar({ ...zap, status: "qualificacao" }, ligada)).toContain("Novos");
    expect(motivoSemAcionar({ ...zap, email: null }, ligada)).toContain("Sem e-mail");
    expect(motivoSemAcionar({ ...zap, agente_parou_em: "2026-09-30T10:00:00Z" }, ligada)).toContain("não receber");
    expect(motivoSemAcionar(zap, { ativo: false, outrasOrigens: true })).toContain("desligada");
    expect(motivoSemAcionar(zap, { ativo: true, outrasOrigens: false })).toContain("Política");
  });

  it("cuida sozinha do site em Novos; dos outros canais, só se acionada", () => {
    expect(leticiaCuidando({ ...zap, origem: "site" }, ligada)).toBe(true);
    expect(leticiaCuidando(zap, ligada)).toBe(false);
    expect(leticiaCuidando({ ...zap, agente_acionado_em: "2026-09-30T10:00:00Z" }, ligada)).toBe(true);
    expect(leticiaCuidando({ ...zap, origem: "site", status: "qualificacao" }, ligada)).toBe(false);
    expect(leticiaCuidando({ ...zap, origem: "site" }, { ativo: false, outrasOrigens: true })).toBe(false);
  });
});

describe("numerosDoPipeline", () => {
  const agora = Date.parse("2026-09-30T12:00:00Z");
  const ha = (d: number) => new Date(agora - d * 86_400_000).toISOString();

  it("conta aberto, novos, demos, ganhos em 30 dias e a conversão em 90 dias", () => {
    const n = numerosDoPipeline(
      [
        { status: "novo", status_desde: ha(1) },
        { status: "novo", status_desde: ha(2) },
        { status: "demonstracao", status_desde: ha(3) },
        { status: "ganho", status_desde: ha(10) },
        { status: "ganho", status_desde: ha(60) },
        { status: "perdido", status_desde: ha(20) },
        { status: "perdido", status_desde: ha(200) },
      ],
      agora,
    );
    expect(n).toEqual({ abertos: 3, novos: 2, demos: 1, ganhos30: 1, conversao90: 67 });
  });

  it("sem fechados, a conversão fica em branco, e não em zero", () => {
    expect(numerosDoPipeline([{ status: "novo", status_desde: ha(1) }], agora).conversao90).toBeNull();
  });
});

describe("tempoNaEtapa e busca", () => {
  const agora = Date.parse("2026-09-30T12:00:00Z");
  it("conta os dias na etapa", () => {
    expect(tempoNaEtapa("2026-09-30T08:00:00Z", agora)).toBe("hoje");
    expect(tempoNaEtapa("2026-09-29T08:00:00Z", agora)).toBe("há 1 dia");
    expect(tempoNaEtapa("2026-09-18T12:00:00Z", agora)).toBe("há 12 dias");
  });

  it("busca sem acento e pelo telefone", () => {
    const lead = { academia: "Academia Fênix", nome: "João", cidade: "São Paulo", email: null, telefone: "11988887777" };
    expect(combinaBusca(lead, "fenix")).toBe(true);
    expect(combinaBusca(lead, "sao paulo")).toBe(true);
    expect(combinaBusca(lead, "8888")).toBe(true);
    expect(combinaBusca(lead, "leve")).toBe(false);
  });
});
