import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  categoriaPorPalavras,
  entradaDoModelo,
  espelhoAceito,
  lerRespostaModelo,
  montarEmail,
  motivoDoEmail,
  ORIGENS,
  primeiroNome,
  PROPOSTA,
  tirarContatos,
  usaEspelho,
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
    ["A recepção libera a Toletus na mão", "catraca"],
    ["Temos Intelbras na entrada", "catraca"],
    ["O equipamento da porta é Hikvision", "catraca"],
    ["Nossa Henry é antiga", "catraca"],
    ["Temos Dimep nas duas unidades", "catraca"],
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

// O que a Letícia diz da catraca não promete mais que a página de vendas: as
// marcas integradas, com a ressalva do modelo conferido na implantação. A
// Henry e a Dimep não estão integradas e não aparecem como integradas.
describe("a catraca no e-mail", () => {
  const MARCAS = ["Control iD", "Topdata", "Toletus", "Intelbras", "Hikvision"];
  const site = readFileSync(join(__dirname, "..", "pages", "public", "Landing.tsx"), "utf8");
  const perguntaDoSite = site.split("\n").find((l) => l.includes("Preciso trocar de catraca?")) ?? "";

  it("cita as marcas que o site anuncia, com a ressalva do modelo, e nenhuma outra", () => {
    expect(perguntaDoSite).not.toBe("");
    for (const marca of MARCAS) {
      expect(PROPOSTA.catraca).toContain(marca);
      expect(perguntaDoSite).toContain(marca);
    }
    expect(PROPOSTA.catraca).toContain("O modelo exato é conferido na implantação");
    expect(PROPOSTA.catraca).not.toMatch(/henry|dimep/i);
  });

  it("nenhum e-mail de catraca promete integração com a catraca que a academia tem", () => {
    for (const etapa of ["primeira", "retorno_1", "retorno_2"] as const) {
      const { texto } = montarEmail({
        etapa,
        nome: "Mariana",
        academia: "Academia Forte",
        categoria: "catraca",
        espelho: null,
        origem: "site",
        origemDetalhe: null,
        agenda: "https://calendly.com/arkefit/demonstracao",
        linkParar: "https://app.arkefit.com.br/#/contato/parar?t=abc",
        assinatura: "Equipe comercial ArkeFit",
      });
      expect(texto).not.toMatch(/se liga à catraca da academia|integração com a catraca|henry|dimep/i);
    }
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
    origem: "site",
    origemDetalhe: "google / cpc",
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

  it("nenhum canal fala de preço, plano ou valor, e todo e-mail diz por que chegou", () => {
    for (const origem of ORIGENS) {
      for (const etapa of ["primeira", "retorno_1", "retorno_2"] as const) {
        const { texto } = montarEmail({ ...base, etapa, origem, origemDetalhe: "Google Maps", academia: "Academia Forte" });
        const corpo = texto.split("\n—")[0].replace(base.agenda, "");
        expect(corpo).not.toMatch(/R\$|%|\bpre[çc]o|\bplanos?\b|\bdesconto/i);
        expect(texto).toContain(motivoDoEmail(origem, "Google Maps"));
      }
    }
  });

  it("cada canal abre dizendo por que escrevemos", () => {
    const abre = (origem: DadosEmail["origem"]) =>
      montarEmail({ ...base, origem, origemDetalhe: "Google Maps", academia: "Academia Forte" }).texto;
    expect(abre("whatsapp")).toContain("Obrigado pelo contato pelo WhatsApp.");
    expect(abre("telefone")).toContain("Obrigado pela conversa por telefone.");
    expect(abre("indicacao")).toContain("Sua academia nos foi indicada");
    expect(abre("prospeccao")).toContain("Encontramos o contato de Academia Forte numa busca por academias (Google Maps)");
    expect(abre("prospeccao")).toContain("está publicado na internet (Google Maps)");
    // O rodapé do site não aparece para quem não pediu contato pelo site.
    expect(abre("prospeccao")).not.toContain("pediu contato em arkefit.com.br");
  });

  it("a frase da IA só entra onde a própria academia contou algo", () => {
    const espelho = "Ver aluno sumir sem ninguém perceber a tempo é frustrante para quem cuida de uma academia.";
    expect(usaEspelho("site") && usaEspelho("whatsapp") && usaEspelho("telefone")).toBe(true);
    expect(usaEspelho("indicacao") || usaEspelho("prospeccao")).toBe(false);
    expect(montarEmail({ ...base, origem: "whatsapp", espelho }).texto).toContain(espelho);
    expect(montarEmail({ ...base, origem: "indicacao", espelho }).texto).not.toContain(espelho);
    expect(montarEmail({ ...base, origem: "prospeccao", origemDetalhe: "Instagram", espelho }).texto).not.toContain(espelho);
  });

  it("escapa no HTML a fonte da prospecção, que é digitada pela equipe", () => {
    const e = montarEmail({ ...base, origem: "prospeccao", origemDetalhe: "<i>Maps</i>" });
    expect(e.html).not.toContain("<i>");
    expect(e.html).toContain("&lt;i&gt;Maps&lt;/i&gt;");
  });

  it("os lembretes têm assunto próprio e o último avisa que é o último", () => {
    expect(montarEmail({ ...base, etapa: "retorno_1" }).assunto).toBe("Um horário com o Jean, Mariana?");
    expect(montarEmail({ ...base, etapa: "retorno_1", nome: "" }).assunto).toBe("Um horário com o Jean?");
    const r2 = montarEmail({ ...base, etapa: "retorno_2" });
    expect(r2.assunto).toBe("Último lembrete sobre a demonstração do ArkeFit");
    expect(r2.texto).toContain("último lembrete");
  });
});
