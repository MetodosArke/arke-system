import { describe, expect, it } from "vitest";
import { abreNoModoEssencial, decidirAcessoDoPainel, menuNoModoEssencial, type LinhaBloqueio } from "./modoEssencial";
import { buildSections } from "./menuPainel";

const linha = (l: Partial<LinhaBloqueio>): LinhaBloqueio => ({
  organization_id: "org-1",
  organizacao_nome: "Academia",
  bloqueada: false,
  cobrancas_vencidas: 0,
  valor_em_aberto: 0,
  vencimento_mais_antigo: null,
  invoice_url: null,
  modo: "normal",
  ...l,
});

describe("decidirAcessoDoPainel", () => {
  it("gestor, professor e nutricionista da academia bloqueada: bloqueio", () => {
    const l = linha({ bloqueada: true, modo: "bloqueio", cobrancas_vencidas: 1, vencimento_mais_antigo: "2026-09-28" });
    expect(decidirAcessoDoPainel([l], "org-1")).toEqual({ tipo: "bloqueio", linha: l });
  });

  it("a recepção da academia ativa bloqueada: essencial", () => {
    expect(decidirAcessoDoPainel([linha({ modo: "essencial" })], "org-1")).toEqual({ tipo: "essencial" });
  });

  it("em dia, ou isento (sem linha): normal, sem faixa", () => {
    expect(decidirAcessoDoPainel([linha({})], "org-1")).toEqual({ tipo: "normal", tolerancia: null });
    expect(decidirAcessoDoPainel([], "org-1")).toEqual({ tipo: "normal", tolerancia: null });
  });

  it("na tolerância: normal, com a linha da faixa", () => {
    const l = linha({ cobrancas_vencidas: 1, vencimento_mais_antigo: "2026-10-05", invoice_url: "https://asaas.test/x" });
    expect(decidirAcessoDoPainel([l], "org-1")).toEqual({ tipo: "normal", tolerancia: l });
  });

  it("o essencial de outra academia não vale na ativa", () => {
    expect(decidirAcessoDoPainel([linha({ organization_id: "org-2", modo: "essencial" }), linha({})], "org-1").tipo).toBe("normal");
    expect(decidirAcessoDoPainel([linha({ modo: "essencial" })], null).tipo).toBe("normal");
  });

  it("a bloqueada manda, em qualquer academia, e vence o essencial", () => {
    const outra = linha({ organization_id: "org-2", bloqueada: true, modo: "bloqueio" });
    expect(decidirAcessoDoPainel([linha({ modo: "essencial" }), outra], "org-1")).toEqual({ tipo: "bloqueio", linha: outra });
  });

  it("sem a coluna modo (a função de antes), ninguém fica em modo essencial", () => {
    expect(decidirAcessoDoPainel([linha({ modo: undefined })], "org-1").tipo).toBe("normal");
  });
});

describe("abreNoModoEssencial", () => {
  it("o balcão abre; a gestão e a massa não; o endereço desconhecido não", () => {
    expect(abreNoModoEssencial("/admin")).toBe(true);
    expect(abreNoModoEssencial("/admin/alunos")).toBe(true);
    expect(abreNoModoEssencial("/admin/ajuda/catracas")).toBe(true);
    expect(abreNoModoEssencial("/admin/funil")).toBe(false);
    expect(abreNoModoEssencial("/admin/alunos/importar")).toBe(false);
    expect(abreNoModoEssencial("/admin/pagina-nova")).toBe(false);
  });
});

describe("menuNoModoEssencial", () => {
  it("tira o item pausado e devolve o nome dele para a nota, sem seção vazia", () => {
    const completo = buildSections({
      ehStudio: false,
      podeGerenciarEquipe: false,
      podePrescreverTreino: false,
      podePrescreverDieta: false,
      alunosLabel: "Alunos",
    });
    const { secoes, pausados } = menuNoModoEssencial(completo);
    expect(secoes.flatMap((s) => s.items.map((i) => i.path))).toEqual([
      "/admin/dashboard",
      "/admin",
      "/admin/mensagens",
      "/admin/alunos",
      "/admin/checkin-qr",
    ]);
    expect(pausados).toEqual(["Funil de Vendas", "Engajamento", "Comunicados"]);
    expect(menuNoModoEssencial([{ label: "Inteligência", items: [{ icon: completo[0].items[0].icon, label: "Gestão 360°", path: "/admin/gestao-360" }] }]).secoes).toEqual([]);
  });
});
