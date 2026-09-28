import { describe, expect, it } from "vitest";
import {
  categoriaPorPalavras,
  entradaDoModelo,
  espelhoAceito,
  lerRespostaModelo,
  montarEmail,
  primeiroNome,
  PROPOSTA,
  tirarContatos,
  type DadosEmail,
} from "../../supabase/functions/agente-comercial/fluxo";

// Letícia, o agente comercial. O que se trava aqui é a regra "nenhuma IA
// escreve número": o espelho da IA só entra no e-mail se passar pela checagem,
// e o resto do e-mail é texto nosso.

describe("categoriaPorPalavras", () => {
  it.each([
    ["Estamos perdendo muitos alunos, eles somem depois de dois meses", "evasao"],
    ["O cancelamento está alto e a retenção caiu", "evasao"],
    ["Temos muita inadimplência, boleto atrasado todo mês", "inadimplencia"],
    ["Queremos integrar a catraca Control iD com biometria", "catraca"],
    ["Hoje usamos o Tecnofit e queremos trocar de sistema", "migracao"],
    ["Quero melhorar o acompanhamento e o app para os alunos", "atendimento"],
    ["Gostaria de uma demonstração", "outro"],
    ["", "outro"],
  ])("%s → %s", (mensagem, esperado) => {
    expect(categoriaPorPalavras(mensagem)).toBe(esperado);
  });

  it("dá prioridade à evasão quando a mensagem também cita o sistema atual", () => {
    expect(categoriaPorPalavras("Usamos o EVO e os alunos desistem cedo")).toBe("evasao");
  });
});

describe("tirarContatos", () => {
  it("tira e-mail e telefone antes de a mensagem ir ao modelo", () => {
    const t = tirarContatos("Me liga no (11) 99999-0000 ou +55 11 98888-7777, ou escreve para dono@academia.com.br");
    expect(t).not.toMatch(/\d{4}/);
    expect(t).not.toContain("@");
    expect(t).toContain("[telefone]");
    expect(t).toContain("[e-mail]");
  });

  it("a entrada do modelo leva a mensagem limpa, a faixa e o sistema, e nada de nome", () => {
    const e = entradaDoModelo({ mensagem: "Meu cel 11 99999-0000", alunos_faixa: "151_500", sistema_atual: "EVO" });
    expect(e).not.toContain("99999");
    expect(e).toContain("de 151 a 500 alunos");
    expect(e).toContain("EVO");
  });
});

describe("espelhoAceito", () => {
  const bom = "Perder alunos nos primeiros meses, sem a recepção perceber a tempo, é das coisas mais frustrantes para quem cuida de uma academia.";

  it("aceita uma frase de empatia sem número nem promessa", () => {
    expect(espelhoAceito(bom)).toBe(true);
  });

  it.each([
    ["número", "Academias do seu porte perdem 30 alunos por mês."],
    ["percentual escrito", "A evasão costuma passar de dez por cento, o que é % alto."],
    ["reais", "Isso custa caro, mais de R$ mil por mês em alunos perdidos."],
    ["preço", "Entendemos que o preço é importante para a sua academia agora."],
    ["plano", "O plano certo faz toda a diferença para a sua academia crescer."],
    ["promessa", "Garantimos que a sua academia vai parar de perder alunos."],
    ["solução", "Sua academia precisa de uma solução que acompanhe cada aluno de perto."],
    ["fala da ArkeFit", "A ArkeFit entende bem o que a sua academia está vivendo agora."],
    ["pergunta", "Você já pensou em quantos alunos saem sem ninguém perceber?"],
    ["link", "Veja mais em https://arkefit.com.br sobre a evasão de alunos."],
    ["curto demais", "Entendemos."],
    ["longo demais", "Entendemos a sua preocupação. ".repeat(15)],
  ])("recusa %s", (_, texto) => {
    expect(espelhoAceito(texto)).toBe(false);
  });
});

describe("lerRespostaModelo", () => {
  it("lê o JSON mesmo com texto em volta", () => {
    const r = lerRespostaModelo(`Aqui está:\n{"categoria": "evasao", "espelho": "Ver aluno sumir sem ninguém perceber a tempo é frustrante para quem cuida de uma academia."}`);
    expect(r.categoria).toBe("evasao");
    expect(r.espelho).toMatch(/^Ver aluno sumir/);
  });

  it("descarta o espelho que não passa na checagem, mas guarda a categoria", () => {
    const r = lerRespostaModelo(`{"categoria": "inadimplencia", "espelho": "Com o nosso plano a inadimplência cai 40% no primeiro mês."}`);
    expect(r).toEqual({ categoria: "inadimplencia", espelho: null });
  });

  it("categoria fora da lista vira nula; lixo vira nulo", () => {
    expect(lerRespostaModelo(`{"categoria": "vendas", "espelho": ""}`)).toEqual({ categoria: null, espelho: null });
    expect(lerRespostaModelo("não sei")).toEqual({ categoria: null, espelho: null });
    expect(lerRespostaModelo("{quebrado")).toEqual({ categoria: null, espelho: null });
  });
});

describe("primeiroNome", () => {
  it.each([
    ["MARIANA SOUZA", "Mariana"],
    ["joão da silva", "João"],
    ["McLaren Souza", "McLaren"],
    ["   ", ""],
  ])("%s → %s", (nome, esperado) => {
    expect(primeiroNome(nome)).toBe(esperado);
  });
});

describe("montarEmail", () => {
  const base: DadosEmail = {
    etapa: "primeira",
    nome: "MARIANA SOUZA",
    academia: "Studio <b>Forte</b>",
    categoria: "evasao",
    espelho: null,
    agenda: "https://calendly.com/arkefit/demonstracao",
    linkParar: "https://app.arkefit.com.br/#/contato/parar?t=abc",
    assinatura: "Equipe comercial ArkeFit",
  };

  it("a primeira leva o convite, o link da agenda, o link para parar e a assinatura", () => {
    const e = montarEmail(base);
    expect(e.assunto).toBe("Studio <b>Forte</b> e o ArkeFit");
    expect(e.texto).toContain("Olá, Mariana!");
    expect(e.texto).toContain(PROPOSTA.evasao);
    expect(e.texto).toContain(base.agenda);
    expect(e.texto).toContain(base.linkParar);
    expect(e.texto).toContain("Equipe comercial ArkeFit");
    expect(e.html).toContain(`href="${base.agenda}"`);
    expect(e.html).toContain("Clique aqui");
  });

  it("escapa no HTML o que veio de fora: o nome digitado e o texto da IA", () => {
    const e = montarEmail({
      ...base,
      nome: "<b>Ana</b>",
      espelho: "<script>alert(1)</script> Ver aluno sumir sem ninguém perceber é frustrante.",
    });
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<b>");
    expect(e.html).toContain("&lt;script&gt;");
  });

  it("sem espelho, abre com o agradecimento fixo; com espelho, abre com ele", () => {
    expect(montarEmail(base).texto).toContain("Obrigado por contar um pouco sobre a sua academia.");
    const espelho = "Ver aluno sumir sem ninguém perceber a tempo é frustrante para quem cuida de uma academia.";
    expect(montarEmail({ ...base, espelho }).texto).toContain(espelho);
  });

  it("nenhum e-mail fala de preço, plano ou valor", () => {
    for (const etapa of ["primeira", "retorno_1", "retorno_2"] as const) {
      for (const categoria of Object.keys(PROPOSTA) as (keyof typeof PROPOSTA)[]) {
        const { texto } = montarEmail({ ...base, etapa, categoria, academia: "Academia Forte" });
        const corpo = texto.split("\n—")[0].replace(base.agenda, "");
        expect(corpo).not.toMatch(/R\$|%|\bpre[çc]o|\bplanos?\b|\bdesconto/i);
        expect(corpo).not.toMatch(/\d/);
      }
    }
  });

  it("os lembretes têm assunto próprio e o último avisa que é o último", () => {
    expect(montarEmail({ ...base, etapa: "retorno_1" }).assunto).toBe("Um horário com o Jean, Mariana?");
    expect(montarEmail({ ...base, etapa: "retorno_1", nome: "" }).assunto).toBe("Um horário com o Jean?");
    const r2 = montarEmail({ ...base, etapa: "retorno_2" });
    expect(r2.assunto).toBe("Último lembrete sobre a demonstração do ArkeFit");
    expect(r2.texto).toContain("último lembrete");
  });
});
