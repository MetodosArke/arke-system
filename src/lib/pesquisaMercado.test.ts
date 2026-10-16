import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESCALA,
  PERGUNTAS,
  VERSAO_QUESTIONARIO,
  contarOpcoes,
  linhasDoCsv,
  recursosPorEssencial,
  validarContato,
  validarPesquisa,
  validarRespostas,
  type Respostas,
} from "../../supabase/functions/pesquisa-mercado/questionario";

/** Todas as fechadas respondidas com a primeira opção. */
function completas(extra: Respostas = {}): Respostas {
  const r: Respostas = {};
  for (const p of PERGUNTAS) {
    if (p.tipo === "texto") continue;
    r[p.id] = p.tipo === "escala" ? "essencial" : p.tipo === "varias" ? [p.opcoes[0].id] : p.opcoes[0].id;
  }
  return { ...r, ...extra };
}

describe("o questionário", () => {
  it("tem as 29 perguntas, numeradas em ordem, e os 18 recursos na escala de 5", () => {
    expect(PERGUNTAS.map((p) => p.numero)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
    expect(PERGUNTAS.filter((p) => p.tipo === "escala")).toHaveLength(18);
    expect(ESCALA.map((o) => o.rotulo)).toEqual([
      "Uso e é essencial",
      "Uso, mas vivo sem",
      "Não uso, mas teria interesse",
      "Não uso e não faz falta",
      "Não sei o que é",
    ]);
    expect(new Set(PERGUNTAS.map((p) => p.id)).size).toBe(PERGUNTAS.length);
  });
});

describe("validarRespostas: só o que está na lista fechada", () => {
  it("aceita a resposta completa, na ordem do questionário", () => {
    const r = validarRespostas(completas({ usa_sistema_qual: "  Planilha   própria ", recurso_para_trocar: "Cobrança que funcione" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.respostas)[0]).toBe("papel");
    expect(r.respostas.usa_sistema_qual).toBe("Planilha própria");
    expect(r.respostas.recurso_para_trocar).toBe("Cobrança que funcione");
  });

  it("a pergunta 6 só vale para quem usa sistema, e o texto só com a opção dele", () => {
    const r = validarRespostas(completas({ usa_sistema: "nao", quanto_paga: "ate_200", usa_sistema_qual: "Algum" }));
    expect(r.ok && r.respostas).toEqual(expect.not.objectContaining({ quanto_paga: expect.anything() }));
    expect(r.ok && r.respostas).toEqual(expect.not.objectContaining({ usa_sistema_qual: expect.anything() }));
    const semSeis = completas();
    delete semSeis.quanto_paga;
    expect(validarRespostas({ ...semSeis, usa_sistema: "nao" }).ok).toBe(true);
    expect(validarRespostas(semSeis)).toMatchObject({ ok: false, pergunta: "quanto_paga", erro: "Responda a pergunta 6." });
  });

  it("recusa opção fora da lista, chave desconhecida e tipo errado", () => {
    expect(validarRespostas(completas({ papel: "presidente" }))).toMatchObject({ ok: false, pergunta: "papel" });
    expect(validarRespostas(completas({ cobranca_automatica: "talvez" }))).toMatchObject({ ok: false, pergunta: "cobranca_automatica" });
    expect(validarRespostas(completas({ tira_o_sono: "evasao" }))).toMatchObject({ ok: false, pergunta: "tira_o_sono" });
    expect(validarRespostas(completas({ recurso_para_trocar: 42 as unknown as string }))).toMatchObject({ ok: false, pergunta: "recurso_para_trocar" });
    expect(validarRespostas({ ...completas(), concorrente: "x" })).toEqual({ ok: false, pergunta: null, erro: "Pedido inválido." });
    expect(validarRespostas(null)).toMatchObject({ ok: false, pergunta: null });
    expect(validarRespostas([])).toMatchObject({ ok: false, pergunta: null });
  });

  it("cobra cada fechada e o limite das de várias escolhas", () => {
    const falta = completas();
    delete falta.relatorios;
    expect(validarRespostas(falta)).toEqual({ ok: false, pergunta: "relatorios", erro: "Responda a pergunta 24." });
    expect(validarRespostas(completas({ tira_o_sono: [] }))).toMatchObject({ ok: false, pergunta: "tira_o_sono" });
    expect(validarRespostas(completas({ tira_o_sono: ["evasao", "captar", "equipe", "catraca"] }))).toEqual({
      ok: false,
      pergunta: "tira_o_sono",
      erro: "Na pergunta 7, escolha até 3.",
    });
    const r = validarRespostas(completas({ pesa_na_escolha: ["suporte", "preco", "preco"] }));
    expect(r.ok && r.respostas.pesa_na_escolha).toEqual(["preco", "suporte"]);
  });
});

describe("validarContato: o e-mail só com autorização", () => {
  it("sem e-mail e sem caixa, não há contato", () => {
    expect(validarContato(undefined)).toEqual({ ok: true, contato: null });
    expect(validarContato({ email: " ", resultado: false, conhecer: false })).toEqual({ ok: true, contato: null });
  });

  it("e-mail sem caixa marcada, ou caixa sem e-mail, é recusado", () => {
    expect(validarContato({ email: "a@b.com" })).toMatchObject({ ok: false, pergunta: "contato" });
    expect(validarContato({ resultado: true })).toMatchObject({ ok: false, erro: "Informe o e-mail, ou desmarque as caixas." });
    expect(validarContato({ email: "sem-arroba", resultado: true })).toMatchObject({ ok: false, erro: "Confira o e-mail." });
  });

  it("só o resultado: e-mail em minúsculas, sem nome; conhecer pede nome e academia", () => {
    expect(validarContato({ email: "Dono@Academia.com.br", resultado: true, nome: "Ignorado" })).toEqual({
      ok: true,
      contato: { email: "dono@academia.com.br", resultado: true, conhecer: false, nome: null, academia: null },
    });
    expect(validarContato({ email: "a@b.com", conhecer: true, academia: "Box X" })).toMatchObject({ ok: false, erro: "Informe o seu nome." });
    expect(validarContato({ email: "a@b.com", conhecer: true, nome: "Ana" })).toMatchObject({ ok: false, erro: "Informe o nome da academia." });
    // "true" em texto não é autorização: a caixa manda booleano.
    expect(validarContato({ email: "a@b.com", resultado: "true" })).toMatchObject({ ok: false });
  });

  it("o pedido inteiro confere a versão do questionário", () => {
    expect(validarPesquisa({ versao: VERSAO_QUESTIONARIO, respostas: completas() })).toMatchObject({ ok: true, contato: null });
    expect(validarPesquisa({ versao: VERSAO_QUESTIONARIO - 1, respostas: completas() })).toMatchObject({ ok: false, versaoAntiga: true });
  });
});

describe("os resultados", () => {
  const lista: Respostas[] = [
    completas({ papel: "gestor", nota_fiscal: "nao_sei", tira_o_sono: ["evasao", "inadimplencia"] }),
    completas({ papel: "dono_socio", nota_fiscal: "essencial", relatorios: "vivo_sem", tira_o_sono: ["evasao"] }),
    completas({ papel: "fora_da_lista" }),
    {},
  ];

  it("conta quem respondeu e o percentual sobre quem respondeu", () => {
    const papel = contarOpcoes(PERGUNTAS.find((p) => p.id === "papel")!, lista);
    expect(papel.responderam).toBe(2);
    expect(papel.opcoes.find((o) => o.id === "gestor")).toMatchObject({ total: 1, pct: 50 });
    const sono = contarOpcoes(PERGUNTAS.find((p) => p.id === "tira_o_sono")!, lista);
    expect(sono.opcoes.find((o) => o.id === "evasao")).toMatchObject({ total: 3, pct: 100 });
  });

  it("os recursos vêm do mais essencial para o menos", () => {
    const ordem = recursosPorEssencial(lista).map((r) => r.pergunta.id);
    expect(ordem.slice(-2)).toEqual(["nota_fiscal", "relatorios"]);
    expect(ordem[0]).toBe("cobranca_automatica");
  });

  it("o CSV tem uma linha por resposta, com os rótulos, e nenhuma coluna de e-mail", () => {
    const csv = linhasDoCsv([{ versao: 1, respondida_em: "2026-10-15", respostas: lista[0] }]);
    expect(csv).toHaveLength(2);
    expect(csv[0]).not.toContain("E-mail");
    expect(csv.flat().join(" ")).not.toContain("@");
    expect(csv[1].slice(0, 3)).toEqual(["15/10/2026", 1, "Gestor"]);
    expect(csv[1]).toContain("Aluno que some e cancela | Inadimplência");
  });
});

describe("a guarda da pesquisa no banco e na função", () => {
  const raiz = join(__dirname, "..", "..");
  const migration = readFileSync(join(raiz, "supabase", "migrations", "20261446010000_pesquisa_de_mercado.sql"), "utf8");
  const funcao = readFileSync(join(raiz, "supabase", "functions", "pesquisa-mercado", "index.ts"), "utf8");
  const tabela = (nome: string) => migration.slice(migration.indexOf(`create table public.${nome}`)).split(");")[0];

  it("a resposta não guarda e-mail, IP nem a hora; nenhuma das duas guarda IP", () => {
    expect(tabela("pesquisa_mercado_respostas")).not.toMatch(/\bemail\b|\bip(_hash)?\b|timestamptz/);
    expect(tabela("pesquisa_mercado_respostas")).toMatch(/respondida_em date/);
    expect(tabela("pesquisa_mercado_emails")).not.toMatch(/\bip(_hash)?\b/);
  });

  it("só a service role grava, e a função pública passa pelo freio, pelo captcha e pela validação", () => {
    expect(migration).toMatch(/revoke execute on function public\.registrar_pesquisa_mercado\([^)]*\) from public, anon, authenticated;/);
    expect(funcao).toMatch(/servir\("pesquisa-mercado"/);
    expect(funcao).toMatch(/dentroDoFreio\(admin, freio\)/);
    expect(funcao).toMatch(/verificarCaptcha\(/);
    expect(funcao).toMatch(/validarPesquisa\(corpo\)/);
    expect(readFileSync(join(raiz, "supabase", "config.toml"), "utf8")).toMatch(/\[functions\.pesquisa-mercado\]\r?\nverify_jwt = false/);
  });
});
