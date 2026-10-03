import { describe, expect, it } from "vitest";
import {
  chamadoDevido,
  conferirAsaasDevido,
  diaUtilDepois,
  emailDevido,
  emHorarioComercial,
  montarChamado,
  montarEmail,
  proximaEtapa,
  TETO_DIARIO,
  type Etapa,
  type Implantacao,
  type MensagemRegistrada,
} from "../../supabase/functions/agente-implantacao/fluxo";
import * as tela from "./implantacao";

/**
 * Bruno, o agente de implantação: o que ele decide fazer e o que escreve.
 * O banco e o envio ficam no index.ts; aqui é a regra.
 */

// Datas em Brasília (UTC-3): 2026-10-05 é segunda.
const br = (iso: string) => new Date(`${iso}-03:00`);

const ORDEM = ["dados", "recebimentos", "planos", "equipe", "alunos", "contrato", "liberacao", "primeira_entrada", "lancamento"];

function etapas(feitas: string[], extras: Partial<Record<"evasao_anterior" | "asaas_aprovada", boolean>> = {}): Etapa[] {
  return [
    ...ORDEM.map((etapa, i) => ({ etapa, ordem: i + 1, principal: true, concluida: feitas.includes(etapa), detalhe: null })),
    { etapa: "evasao_anterior", ordem: 10, principal: false, concluida: !!extras.evasao_anterior, detalhe: null },
    { etapa: "asaas_aprovada", ordem: 11, principal: false, concluida: !!extras.asaas_aprovada, detalhe: null },
  ];
}

function msg(tipo: MensagemRegistrada["tipo"], chave: string, etapa: string | null, enviado: string, status: MensagemRegistrada["status"] = "enviada"): MensagemRegistrada {
  return { tipo, chave, etapa, status, criado_em: br(enviado).toISOString(), enviado_em: status === "enviada" ? br(enviado).toISOString() : null };
}

function implantacao(p: Partial<Implantacao> = {}): Implantacao {
  return {
    organization_id: "00000000-0000-0000-0000-000000000001",
    nome: "Academia Teste",
    slug: "academia-teste",
    tipo: "academia",
    status: "ativo",
    emails: ["gestor@academia.com"],
    etapas: etapas([]),
    iniciada_em: br("2026-10-01T10:00:00").toISOString(),
    etapa_atual: null,
    etapa_atual_desde: null,
    concluida_em: null,
    asaas_conta_origem: null,
    asaas_conta_status: null,
    asaas_conferido_em: null,
    mensagens: [],
    evasao_inicio: "2026-04-01",
    evasao_fim: "2026-09-01",
    ...p,
  };
}

const SEG_10 = br("2026-10-05T10:00:00");

describe("calendário de Brasília", () => {
  it("1 dia útil: sexta vence na segunda, e o fim de semana não conta", () => {
    expect(diaUtilDepois(br("2026-10-02T15:00:00"))).toEqual(br("2026-10-05T15:00:00"));
    expect(diaUtilDepois(br("2026-10-05T10:00:00"))).toEqual(br("2026-10-06T10:00:00"));
    expect(diaUtilDepois(br("2026-10-01T20:00:00"))).toEqual(br("2026-10-02T20:00:00"));
    // Começou no sábado: o relógio só anda na segunda.
    expect(diaUtilDepois(br("2026-10-03T10:00:00"))).toEqual(br("2026-10-06T00:00:00"));
    expect(diaUtilDepois(br("2026-10-04T23:00:00"))).toEqual(br("2026-10-06T00:00:00"));
  });

  it("horário comercial: dia útil, das 9h às 19h", () => {
    expect(emHorarioComercial(br("2026-10-03T10:00:00"))).toBe(false); // sábado
    expect(emHorarioComercial(br("2026-10-05T08:59:00"))).toBe(false);
    expect(emHorarioComercial(br("2026-10-05T09:00:00"))).toBe(true);
    expect(emHorarioComercial(br("2026-10-09T18:59:00"))).toBe(true);
    expect(emHorarioComercial(br("2026-10-09T19:00:00"))).toBe(false);
  });
});

describe("a sequência", () => {
  it("a etapa da vez é a primeira principal pendente; a evasão e o Asaas não travam", () => {
    expect(proximaEtapa(etapas(["dados", "planos"]))?.etapa).toBe("recebimentos");
    expect(proximaEtapa(etapas(ORDEM.slice(0, 7)))?.etapa).toBe("primeira_entrada");
    expect(proximaEtapa(etapas(ORDEM))).toBeNull();
  });
});

describe("o e-mail da rodada", () => {
  it("sem endereço, fora do horário ou no teto do dia, não sai nada", () => {
    expect(emailDevido(implantacao({ emails: [] }), SEG_10)).toBeNull();
    expect(emailDevido(implantacao(), br("2026-10-03T10:00:00"))).toBeNull();
    const dois = [msg("boas_vindas", "boas_vindas", "dados", "2026-10-05T09:10:00"), msg("pedido_evasao", "1", "evasao_anterior", "2026-10-05T09:30:00")];
    expect(dois.length).toBe(TETO_DIARIO);
    expect(emailDevido(implantacao({ etapas: etapas(["dados"]), mensagens: dois }), SEG_10)).toBeNull();
  });

  it("o primeiro contato é a boas-vindas com a etapa da vez; depois, um próximo passo por etapa", () => {
    expect(emailDevido(implantacao(), SEG_10)).toMatchObject({ tipo: "boas_vindas", etapa: "dados" });
    const comBoasVindas = implantacao({ mensagens: [msg("boas_vindas", "boas_vindas", "dados", "2026-10-02T10:00:00")] });
    // A mesma etapa ainda pendente: nada novo.
    expect(emailDevido(comBoasVindas, SEG_10)).toBeNull();
    // Concluiu os dados e os recebimentos de uma vez: vai só o passo da vez.
    const avancou = { ...comBoasVindas, etapas: etapas(["dados", "recebimentos"]) };
    expect(emailDevido(avancou, SEG_10)).toMatchObject({ tipo: "proximo_passo", chave: "planos", etapa: "planos" });
    const avisado = { ...avancou, mensagens: [...avancou.mensagens, msg("proximo_passo", "planos", "planos", "2026-10-05T09:20:00")] };
    expect(emailDevido(avisado, SEG_10)).toBeNull();
  });

  it("a mensagem que falhou não conta como enviada", () => {
    const falhou = implantacao({ mensagens: [msg("boas_vindas", "boas_vindas", "dados", "2026-10-05T09:00:00", "falhou")] });
    expect(emailDevido(falhou, SEG_10)).toMatchObject({ tipo: "boas_vindas" });
  });

  it("a etapa parada ganha lembrete a cada 3 dias úteis, até dois", () => {
    const base = implantacao({ etapas: etapas(["dados"]), mensagens: [msg("proximo_passo", "recebimentos", "recebimentos", "2026-10-01T10:00:00")] });
    // Quinta 10h + 3 dias úteis = terça 10h.
    expect(emailDevido(base, br("2026-10-06T09:59:00"))).toBeNull();
    expect(emailDevido(base, br("2026-10-06T10:00:00"))).toMatchObject({ tipo: "lembrete", chave: "recebimentos:1" });
    const um = { ...base, mensagens: [...base.mensagens, msg("lembrete", "recebimentos:1", "recebimentos", "2026-10-06T10:00:00")] };
    expect(emailDevido(um, br("2026-10-08T10:00:00"))).toBeNull();
    expect(emailDevido(um, br("2026-10-09T10:00:00"))).toMatchObject({ tipo: "lembrete", chave: "recebimentos:2" });
    const dois = { ...um, mensagens: [...um.mensagens, msg("lembrete", "recebimentos:2", "recebimentos", "2026-10-09T10:00:00")] };
    expect(emailDevido(dois, br("2026-10-20T10:00:00"))).toBeNull();
  });

  it("com a liberação e a primeira entrada, sai o kit", () => {
    const pronto = implantacao({
      etapas: etapas(ORDEM.slice(0, 8)),
      mensagens: [msg("proximo_passo", "primeira_entrada", "primeira_entrada", "2026-10-02T10:00:00")],
    });
    expect(emailDevido(pronto, SEG_10)).toMatchObject({ tipo: "kit_lancamento", chave: "kit" });
  });

  it("a conta do Asaas aprovada ou recusada vira aviso, uma vez", () => {
    const base = implantacao({
      etapas: etapas(["dados", "recebimentos"]),
      asaas_conta_origem: "criada",
      mensagens: [msg("proximo_passo", "planos", "planos", "2026-10-05T09:00:00")],
    });
    expect(emailDevido({ ...base, asaas_conta_status: "APPROVED" }, SEG_10)).toMatchObject({ tipo: "asaas_aprovada" });
    expect(emailDevido({ ...base, asaas_conta_status: "REJECTED" }, SEG_10)).toMatchObject({ tipo: "asaas_recusada" });
    const avisada = { ...base, asaas_conta_status: "APPROVED", mensagens: [...base.mensagens, msg("asaas_aprovada", "aprovada", "recebimentos", "2026-10-05T09:30:00")] };
    expect(emailDevido(avisada, br("2026-10-05T11:00:00"))).toBeNull();
    // Conta da própria academia: não há aprovação a avisar.
    expect(emailDevido({ ...base, asaas_conta_origem: "existente", asaas_conta_status: "APPROVED" }, SEG_10)).toBeNull();
  });

  it("a evasão anterior é pedida com os alunos chegando, e lembrada uma vez depois da liberação", () => {
    const comAlunos = implantacao({
      etapas: etapas(["dados", "recebimentos", "planos", "equipe", "alunos"]),
      mensagens: [msg("proximo_passo", "contrato", "contrato", "2026-10-05T09:00:00")],
    });
    expect(emailDevido(comAlunos, SEG_10)).toMatchObject({ tipo: "pedido_evasao", chave: "1" });
    const pedida = { ...comAlunos, mensagens: [...comAlunos.mensagens, msg("pedido_evasao", "1", "evasao_anterior", "2026-10-01T10:00:00")] };
    // Ainda não liberou: não insiste.
    expect(emailDevido(pedida, br("2026-10-07T10:00:00"))).toBeNull();
    const liberou = {
      ...pedida,
      etapas: etapas(ORDEM.slice(0, 7)),
      mensagens: [...pedida.mensagens, msg("proximo_passo", "primeira_entrada", "primeira_entrada", "2026-10-07T09:00:00")],
    };
    expect(emailDevido(liberou, br("2026-10-07T10:00:00"))).toMatchObject({ tipo: "pedido_evasao", chave: "2" });
    // Informada: não pede mais.
    expect(emailDevido({ ...liberou, etapas: etapas(ORDEM.slice(0, 7), { evasao_anterior: true }) }, br("2026-10-07T10:00:00"))).toBeNull();
  });
});

describe("o chamado da ArkeFit", () => {
  it("1 dia útil parado na mesma etapa: a ArkeFit liga; o kit não chama", () => {
    const imp = implantacao({ etapas: etapas(["dados"]) });
    expect(chamadoDevido(imp, br("2026-10-02T15:00:00"), br("2026-10-05T14:59:00"))).toBeNull();
    expect(chamadoDevido(imp, br("2026-10-02T15:00:00"), br("2026-10-05T15:00:00"))).toMatchObject({ etapa: "recebimentos" });
    expect(chamadoDevido(implantacao({ etapas: etapas(ORDEM.slice(0, 8)) }), br("2026-09-01T10:00:00"), SEG_10)).toBeNull();
    expect(chamadoDevido(imp, null, SEG_10)).toBeNull();
  });
});

describe("a aprovação do Asaas", () => {
  it("conferida uma vez por dia, só na conta que o ArkeFit abriu", () => {
    const criada = implantacao({ asaas_conta_origem: "criada", asaas_conta_status: "PENDING" });
    expect(conferirAsaasDevido(criada, SEG_10)).toBe(true);
    expect(conferirAsaasDevido({ ...criada, asaas_conferido_em: br("2026-10-05T08:00:00").toISOString() }, SEG_10)).toBe(false);
    expect(conferirAsaasDevido({ ...criada, asaas_conferido_em: br("2026-10-04T13:00:00").toISOString() }, SEG_10)).toBe(true);
    expect(conferirAsaasDevido({ ...criada, asaas_conta_status: "APPROVED" }, SEG_10)).toBe(false);
    expect(conferirAsaasDevido(implantacao({ asaas_conta_origem: "existente" }), SEG_10)).toBe(false);
  });
});

describe("os textos", () => {
  const opcoes = { site: "https://app.arkefit.com.br", assinatura: "Equipe de implantação ArkeFit" };

  it("o próximo passo leva o link da tela e o do artigo, e o andamento", () => {
    const imp = implantacao({ etapas: etapas(["dados", "recebimentos"]) });
    const e = montarEmail({ tipo: "proximo_passo", chave: "alunos", etapa: "alunos", motivo: "x" }, imp, opcoes);
    expect(e.assunto).toContain("Alunos");
    expect(e.texto).toContain("https://app.arkefit.com.br/#/admin/alunos/importar");
    expect(e.texto).toContain("https://app.arkefit.com.br/#/admin/ajuda/importar-alunos");
    expect(e.texto).toContain("2 de 9 etapas");
    expect(e.texto).toContain("Equipe de implantação ArkeFit");
  });

  it("o kit traz o convite, a entrada com a marca e a matrícula da academia", () => {
    const e = montarEmail({ tipo: "kit_lancamento", chave: "kit", etapa: "lancamento", motivo: "x" }, implantacao(), opcoes);
    expect(e.texto).toContain("https://app.arkefit.com.br/#/p/academia-teste/primeiro-acesso");
    expect(e.texto).toContain("https://app.arkefit.com.br/#/p/academia-teste/entrar");
    expect(e.texto).toContain("https://app.arkefit.com.br/#/p/academia-teste\n");
    expect(e.texto).toContain("A primeira entrada funcionou");
    const aut = montarEmail({ tipo: "kit_lancamento", chave: "kit", etapa: "lancamento", motivo: "x" }, implantacao({ tipo: "profissional_autonomo" }), opcoes);
    expect(aut.texto).toContain("O primeiro aluno já entrou no app");
  });

  it("o pedido da evasão diz os meses por extenso", () => {
    const e = montarEmail({ tipo: "pedido_evasao", chave: "1", etapa: "evasao_anterior", motivo: "x" }, implantacao(), opcoes);
    expect(e.texto).toContain("de abril de 2026 a setembro de 2026");
  });

  it("o nome da academia vai escapado no HTML", () => {
    const e = montarEmail({ tipo: "boas_vindas", chave: "boas_vindas", etapa: "dados", motivo: "x" }, implantacao({ nome: "<b>X</b>" }), opcoes);
    expect(e.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(e.html).not.toContain("<b>X</b>");
  });

  it("o aviso à ArkeFit aponta a Visão Master e não leva o rodapé da academia", () => {
    const e = montarChamado(implantacao(), { etapa: "recebimentos", motivo: "Parada em recebimentos" }, { site: opcoes.site });
    expect(e.assunto).toBe("Implantação parada: Academia Teste, em Conta de recebimentos");
    expect(e.texto).toContain("https://app.arkefit.com.br/#/superadmin/implantacao");
    expect(e.texto).not.toContain("Você recebe este e-mail");
  });
});

describe("o espelho da tela", () => {
  it("o 1 dia útil da tela é o mesmo do agente, em toda hora de duas semanas", () => {
    for (let h = 0; h < 14 * 24; h += 1) {
      const d = new Date(br("2026-09-28T00:30:00").getTime() + h * 3600_000);
      expect(tela.diaUtilDepois(d).toISOString(), d.toISOString()).toBe(diaUtilDepois(d).toISOString());
    }
  });

  it("dias úteis parada, a janela da evasão e a evasão média", () => {
    expect(tela.diasUteisParada(br("2026-10-02T15:00:00").toISOString(), br("2026-10-06T16:00:00"))).toBe(2);
    expect(tela.diasUteisParada(null)).toBe(0);
    expect(tela.mesesDaJanela("2026-04-01", "2026-09-01")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(tela.mesesDaJanela("2025-10-01", "2026-03-01")).toEqual(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(tela.rotuloMes("2026-04")).toBe("abr/26");
    expect(tela.evasaoMedia([{ alunos_inicio: 400, saidas: 40 }, { alunos_inicio: 200, saidas: 10 }])).toBeCloseTo(7.5);
    expect(tela.evasaoMedia([])).toBeNull();
  });

  it("andamento e próxima etapa contam só a sequência principal", () => {
    const e = etapas(["dados", "recebimentos", "planos"], { evasao_anterior: true });
    expect(tela.andamento(e)).toEqual({ feitas: 3, total: 9, percentual: 33 });
    expect(tela.proximaDaImplantacao(e)?.etapa).toBe("equipe");
  });
});
