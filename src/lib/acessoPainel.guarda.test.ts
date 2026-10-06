import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atendeSaude, cuidaDoDinheiro, podeAbrirNoPainel, ROTAS_DO_PAINEL, type ContextoPainel } from "./acessoPainel";
import { buildSections, buildSectionsProfissionalAutonomo } from "./menuPainel";
import { podePrescrever } from "./prescricaoPermitida";

/**
 * Trava da auditoria de 05/10/2026 (achados médios de acesso): quem vê o quê no
 * painel da academia, nas duas camadas.
 *
 * Antes, as rotas de /admin tinham uma guarda só, de equipe. O menu escondia
 * Gestão 360°, Financeiro e Equipe do professor, mas o endereço digitado abria
 * a página, e o banco entregava a receita (`is_org_staff` inclui professor,
 * nutricionista e recepção). E a recepção via a anamnese, as dores, a
 * avaliação, a dieta e o resumo da IA na ficha.
 *
 * Este teste falha se: uma rota nova de /admin não disser quem a vê; o menu
 * oferecer um item que a rota recusa; o professor voltar a abrir o dinheiro,
 * ou a recepção a saúde; ou a regra do banco voltar a usar `is_org_staff` nas
 * tabelas do dinheiro e da saúde.
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), "utf8").replace(/\r\n/g, "\n");

function rotasDoAdminNoApp(): string[] {
  const app = ler("src", "App.tsx");
  const inicio = app.indexOf('path="/admin"');
  const fim = app.indexOf('path="/superadmin"');
  expect(inicio, "o bloco de /admin existe").toBeGreaterThan(0);
  const bloco = app.slice(inicio, fim);
  const rotas = [...bloco.matchAll(/<Route\s+(index|path="([^"]+)")/g)].map((m) => (m[1] === "index" ? "" : m[2]));
  return rotas.filter((r) => r !== "/admin");
}

const academia = (papel: string | null, adminArke = false): ContextoPainel => ({
  tipoOrganizacao: "academia",
  especialidade: null,
  papel,
  adminArke,
});
const autonomo = (papel: string, especialidade: string): ContextoPainel => ({
  tipoOrganizacao: "profissional_autonomo",
  especialidade,
  papel,
  adminArke: false,
});

/** O menu do jeito que AdminSidebar monta, para o contexto dado. */
function menuDe(c: ContextoPainel, tipo: "academia" | "studio" | "profissional_autonomo") {
  const podePrescreverTreino = podePrescrever("treino", c);
  const podePrescreverDieta = podePrescrever("dieta", c);
  const secoes =
    tipo === "profissional_autonomo"
      ? buildSectionsProfissionalAutonomo({ podePrescreverTreino, podePrescreverDieta, ehDono: c.papel === "gestor" })
      : buildSections({
          ehStudio: tipo === "studio",
          podeGerenciarEquipe: !!c.adminArke || c.papel === "gestor",
          podePrescreverTreino,
          podePrescreverDieta,
          alunosLabel: "Alunos",
        });
  return secoes.flatMap((s) => s.items.map((i) => i.path));
}

describe("rotas do painel: a página confere o papel", () => {
  it("toda rota de /admin do App.tsx diz quem a vê, e a tabela não tem rota velha", () => {
    const noApp = rotasDoAdminNoApp();
    expect(noApp.length, "o detector detecta").toBeGreaterThan(20);
    expect(noApp.filter((r) => !(r in ROTAS_DO_PAINEL)), "falta em ROTAS_DO_PAINEL").toEqual([]);
    expect(Object.keys(ROTAS_DO_PAINEL).filter((r) => !noApp.includes(r)), "rota que saiu do App.tsx").toEqual([]);
  });

  it("o layout do painel passa toda página pelo portão, e o menu é o de menuPainel", () => {
    expect(ler("src", "components", "layout", "AdminLayout.tsx")).toMatch(/<PortaoDaRota>\s*<Outlet \/>\s*<\/PortaoDaRota>/);
    const sidebar = ler("src", "components", "layout", "AdminSidebar.tsx");
    expect(sidebar).toMatch(/from "@\/lib\/menuPainel"/);
    expect(sidebar).not.toMatch(/function buildSections/);
  });

  it("todo item do menu abre pela rota, papel por papel (o menu continua como era)", () => {
    const casos: [string, ContextoPainel, "academia" | "studio" | "profissional_autonomo"][] = [
      ["gestor", academia("gestor"), "academia"],
      ["recepção", academia("recepcao"), "academia"],
      ["professor", academia("professor"), "academia"],
      ["nutricionista", academia("nutricionista"), "academia"],
      ["ArkeFit", academia(null, true), "academia"],
      ["gestor de studio", { ...academia("gestor"), tipoOrganizacao: "studio" }, "studio"],
      ["professor de studio", { ...academia("professor"), tipoOrganizacao: "studio" }, "studio"],
      ["dono personal", autonomo("gestor", "professor"), "profissional_autonomo"],
      ["dono nutricionista", autonomo("gestor", "nutricionista"), "profissional_autonomo"],
      ["parceiro professor", autonomo("professor", "nutricionista"), "profissional_autonomo"],
      ["parceira nutricionista", autonomo("nutricionista", "professor"), "profissional_autonomo"],
    ];
    for (const [quem, c, tipo] of casos) {
      const recusados = menuDe(c, tipo).filter((p) => !podeAbrirNoPainel(p, c));
      expect(recusados, `menu de ${quem}`).toEqual([]);
    }
  });

  it("o dinheiro e a gestão não abrem para professor e nutricionista", () => {
    for (const papel of ["professor", "nutricionista"]) {
      for (const rota of ["gestao-360", "financeiro", "equipe", "organizacao", "configuracoes/integracoes", "alunos/importar", "catracas", "relatorio-semanal", "retencao", "acompanhamento"]) {
        expect(podeAbrirNoPainel(`/admin/${rota}`, academia(papel)), `${papel} em ${rota}`).toBe(false);
      }
      expect(podeAbrirNoPainel("/admin/alunos", academia(papel))).toBe(true);
    }
  });

  it("a recepção cobra e libera a catraca, mas não abre a gestão", () => {
    const r = academia("recepcao");
    expect(podeAbrirNoPainel("/admin/catracas", r)).toBe(true);
    expect(podeAbrirNoPainel("/admin/funil", r)).toBe(true);
    for (const rota of ["gestao-360", "financeiro", "equipe", "organizacao", "configuracoes/integracoes", "alunos/importar"]) {
      expect(podeAbrirNoPainel(`/admin/${rota}`, r), rota).toBe(false);
    }
  });

  it("no painel do autônomo, vendas e dinheiro são do dono", () => {
    const parceiro = autonomo("nutricionista", "professor");
    for (const rota of ["funil", "comunicados", "financeiro", "organizacao", "relatorio-semanal"]) {
      expect(podeAbrirNoPainel(`/admin/${rota}`, parceiro), rota).toBe(false);
      expect(podeAbrirNoPainel(`/admin/${rota}`, autonomo("gestor", "professor")), rota).toBe(true);
    }
  });

  it("endereço fora da tabela não abre, e a ajuda com artigo abre", () => {
    expect(podeAbrirNoPainel("/admin/pagina-que-nao-existe", academia("gestor"))).toBe(false);
    expect(podeAbrirNoPainel("/admin/ajuda/financeiro", academia("professor"))).toBe(true);
    expect(podeAbrirNoPainel("/admin", academia("recepcao"))).toBe(true);
  });
});

// ── O banco ────────────────────────────────────────────────────────────────

const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8").replace(/--[^\n]*/g, "").toLowerCase());

/** A última definição de uma regra (create ou alter), com o texto até o `;`. */
function ultimaRegra(nome: string, tabela: string): string {
  const re = new RegExp(`(?:create|alter) policy "?${nome}"? on public\\.${tabela}\\b[\\s\\S]*?;`, "g");
  let ultima = "";
  for (const sql of migrations) for (const m of sql.match(re) ?? []) ultima = m;
  return ultima.replace(/\s+/g, " ");
}

function ultimaFuncao(nome: string): string {
  const re = new RegExp(`create or replace function public\\.${nome}\\s*\\([\\s\\S]*?\\$\\$;`, "g");
  let ultima = "";
  for (const sql of migrations) for (const m of sql.match(re) ?? []) ultima = m;
  return ultima;
}

function papeisDaFuncao(nome: string): string[] {
  const corpo = ultimaFuncao(nome);
  expect(corpo, `${nome} existe`).not.toBe("");
  expect(corpo, `${nome} responde só sobre quem chama`).toMatch(/user_id = auth\.uid\(\)/);
  const lista = corpo.match(/role in \(([^)]*)\)/)?.[1] ?? "";
  return [...lista.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
}

describe("regras do banco: o dinheiro com quem cobra, a saúde com quem atende", () => {
  it("as duas perguntas do banco e as da tela dizem o mesmo", () => {
    const papeis = ["gestor", "recepcao", "professor", "nutricionista"];
    expect(papeisDaFuncao("cuida_do_dinheiro")).toEqual(papeis.filter((p) => cuidaDoDinheiro(academia(p))).sort());
    expect(papeisDaFuncao("atende_saude")).toEqual(papeis.filter((p) => atendeSaude(academia(p))).sort());
    expect(papeisDaFuncao("cuida_do_dinheiro")).not.toContain("professor");
    expect(papeisDaFuncao("atende_saude")).not.toContain("recepcao");
  });

  const DINHEIRO: [string, string[]][] = [
    ["mensalidades", ["leitura", "inclusão", "alteração", "exclusão"]],
    ["cobrancas_avulsas", ["leitura"]],
    ["pagamentos", ["leitura"]],
    ["aluno_matriculas_academia", ["leitura", "inclusão", "alteração", "exclusão"]],
    ["aluno_assinaturas", ["leitura", "inclusão", "alteração", "exclusão"]],
    ["notas_fiscais", ["leitura"]],
  ];
  it("o dinheiro da academia não passa por is_org_staff", () => {
    for (const [tabela, regras] of DINHEIRO) {
      for (const nome of regras) {
        const regra = ultimaRegra(nome, tabela);
        expect(regra, `${tabela} ${nome} existe`).not.toBe("");
        expect(regra, `${tabela} ${nome}`).toMatch(/cuida_do_dinheiro\(organization_id\)/);
        expect(regra, `${tabela} ${nome}`).not.toMatch(/is_org_staff/);
      }
    }
  });

  const SAUDE: [string, string[]][] = [
    ["anamnese_acolhimento", ["leitura", "inclusão", "alteração", "exclusão"]],
    ["sentinela_anamnese", ["leitura"]],
    ["avaliacoes_fisicas", ["leitura", "inclusão", "alteração", "exclusão"]],
    ["dietas", ["leitura", "inclusão", "alteração", "exclusão"]],
    ["dieta_adesao", ["leitura"]],
  ];
  it("a saúde do aluno não passa por is_org_staff, e a ArkeFit só a lê no Método", () => {
    for (const [tabela, regras] of SAUDE) {
      for (const nome of regras) {
        const regra = ultimaRegra(nome, tabela);
        expect(regra, `${tabela} ${nome} existe`).not.toBe("");
        expect(regra, `${tabela} ${nome}`).toMatch(/atende_saude\(organization_id\)/);
        expect(regra, `${tabela} ${nome}`).not.toMatch(/is_org_staff/);
        // A ArkeFit entra só por equipe_metodo() junto de aluno_no_metodo(), ou para prescrever no Método.
        expect(regra, `${tabela} ${nome}`).not.toMatch(/has_role\(.{0,60}?'(admin_arke|superadmin)'/);
      }
    }
  });

  it("os registros da catraca, com o CPF, não são da ArkeFit pelo RLS", () => {
    const regra = ultimaRegra("staff/admin_arke vê logs de acesso", "acessos_catraca_logs");
    expect(regra).not.toBe("");
    expect(regra).not.toMatch(/admin_arke'/);
  });
});
