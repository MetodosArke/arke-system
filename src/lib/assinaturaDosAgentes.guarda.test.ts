import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  entradaDoModelo,
  espelhoAceito,
  espelhoRecusado,
  lerRespostaModelo,
  SISTEMA_ESPELHO,
  tirarAssinatura,
} from "../../supabase/functions/agente-comercial/fluxo";
import { assinaturaDeEquipe } from "../../supabase/functions/_shared/assinaturaDeEquipe";

/**
 * A Letícia (comercial) e o Bruno (implantação) assinam como equipe, nunca
 * como pessoa (CLAUDE.md). A auditoria de prontidão (07/10/2026) achou a
 * mensagem do contato indo ao modelo com a assinatura e o nome de quem
 * escreveu ("Att, Maria Souza, gerente"), e nada impedia o modelo de devolver
 * um espelho assinado por alguém ou com o nome da pessoa.
 *
 * Agora: a entrada do modelo sai sem a assinatura e sem o nome do contato; o
 * espelho com nome de pessoa, despedida ou assinatura é recusado; e a
 * assinatura do e-mail que não for de equipe volta à padrão.
 */

const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");

const MENSAGEM_REAL = [
  "Boa tarde! Aqui é a Maria, sou gerente da Academia Corpo em Forma.",
  "Nossos alunos somem depois de dois meses e a recepção só percebe quando já cancelaram.",
  "",
  "Att,",
  "Maria Souza",
  "Gerente — Academia Corpo em Forma",
  "(11) 98765-4321",
].join("\n");

describe("o que vai ao modelo da Letícia", () => {
  it("sai sem a assinatura, sem o nome de quem escreveu e sem o telefone, e com o problema", () => {
    const entrada = entradaDoModelo({ mensagem: MENSAGEM_REAL, alunos_faixa: "151_500", sistema_atual: null, nome: "Maria Souza" });
    expect(entrada).not.toMatch(/maria|souza/i);
    expect(entrada).not.toContain("Att");
    expect(entrada).not.toContain("98765");
    expect(entrada).toContain("Nossos alunos somem depois de dois meses");
    expect(entrada).toContain("[nome]");
  });

  it("a assinatura só sai do fim: um \"obrigado\" no começo não leva a mensagem junto", () => {
    const m = "Obrigado pelo retorno.\nOs alunos param de vir e ninguém liga para eles.\nAbraços,\nJoão";
    const sem = tirarAssinatura(m);
    expect(sem).toContain("Obrigado pelo retorno.");
    expect(sem).toContain("ninguém liga para eles");
    expect(sem).not.toContain("João");
  });

  it("o roteiro continua proibindo o nome da pessoa e a despedida", () => {
    expect(SISTEMA_ESPELHO).toContain("não use o nome da pessoa");
    expect(SISTEMA_ESPELHO).toContain("não se despeça");
  });
});

describe("o espelho que o modelo devolve", () => {
  const bom = "Perder alunos nos primeiros meses, sem a recepção perceber a tempo, é das coisas mais frustrantes para quem cuida de uma academia.";

  it("um espelho sem nome continua passando", () => {
    expect(espelhoAceito(bom, ["Maria Souza"])).toBe(true);
  });

  it.each([
    ["assinado pela Letícia", `${bom} Letícia, equipe comercial.`],
    ["assinado pelo Bruno", `${bom} — Bruno`],
    ["com despedida", `${bom} Atenciosamente.`],
    ["com o nome da pessoa", `Maria, perder alunos nos primeiros meses é das coisas mais frustrantes para quem cuida de uma academia.`],
    ["com o marcador do nome", `[nome], perder alunos nos primeiros meses é das coisas mais frustrantes para quem cuida de uma academia.`],
  ])("recusa o espelho %s", (_, espelho) => {
    expect(espelhoAceito(espelho, ["Maria Souza"])).toBe(false);
    const resposta = JSON.stringify({ categoria: "evasao", espelho });
    expect(lerRespostaModelo(resposta, ["Maria Souza"]).espelho).toBeNull();
    expect(espelhoRecusado(resposta, ["Maria Souza"])).toBe(true);
  });
});

describe("a assinatura do e-mail", () => {
  it.each([
    ["Equipe comercial ArkeFit", "Equipe comercial ArkeFit"],
    ["  Equipe   de implantação ArkeFit ", "Equipe de implantação ArkeFit"],
    ["Letícia Souza", "PADRÃO"],
    ["Letícia, da equipe comercial", "PADRÃO"],
    ["Equipe", "PADRÃO"],
    ["", "PADRÃO"],
    [null, "PADRÃO"],
  ])("%s → %s", (configurada, esperada) => {
    expect(assinaturaDeEquipe(configurada, "PADRÃO")).toBe(esperada);
  });

  it("as duas funções dos agentes passam a assinatura por assinaturaDeEquipe", () => {
    for (const funcao of ["agente-comercial", "agente-implantacao"]) {
      const texto = readFileSync(join(FUNCOES, funcao, "index.ts"), "utf8");
      expect(texto, funcao).toMatch(/const assinatura = assinaturaDeEquipe\(/);
    }
  });

  it("a Letícia manda o nome do contato para ser tirado, e confere o espelho contra ele", () => {
    const texto = readFileSync(join(FUNCOES, "agente-comercial", "index.ts"), "utf8");
    expect(texto).toMatch(/entradaDoModelo\(\{[^}]*nome: d\.nome/);
    expect(texto).toMatch(/lerRespostaModelo\(resposta\.texto, nomes\)/);
    expect(texto).toMatch(/espelhoRecusado\(resposta\.texto, nomes\)/);
  });
});
