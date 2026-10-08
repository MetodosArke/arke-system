import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROTAS_DO_PAINEL, type ContextoPainel } from "./acessoPainel";
import { buildSections } from "./menuPainel";
import { abreNoModoEssencial, AVISO_MODO_ESSENCIAL, decidirAcessoDoPainel, menuNoModoEssencial, NO_MODO_ESSENCIAL } from "./modoEssencial";

/**
 * Trava da decisão de 08/10/2026: no bloqueio B2B, a recepção fica em modo
 * essencial, e o gestor, o professor e a nutricionista seguem na tela de
 * suspensão.
 *
 * O defeito que ela previne não dá erro: a rota nova do painel que ninguém
 * classificou. Sem a lista, ela abriria para a recepção da academia bloqueada
 * (a gestão de graça) ou sumiria do balcão sem ninguém decidir. Com a lista,
 * a rota fora dela fica pausada (falha fechada), e este teste falha até alguém
 * dizer se ela é atendimento do balcão ou gestão.
 *
 * Falha se: uma rota de /admin do App.tsx não estiver classificada em
 * `NO_MODO_ESSENCIAL`; a lista do que continua mudar sem passar por aqui; uma
 * rota que continua não abrir para a recepção pelo papel; o menu, o portão das
 * rotas ou a faixa deixarem de ler o modo; o gate ou o banco deixarem de
 * mandar gestor, professor e nutricionista para a suspensão, ou passarem a
 * mandar a recepção; ou o aviso da recepção falar de dinheiro.
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), "utf8").replace(/\r\n/g, "\n");

function rotasDoAdminNoApp(): string[] {
  const app = ler("src", "App.tsx");
  const inicio = app.indexOf('path="/admin"');
  const fim = app.indexOf('path="/superadmin"');
  expect(inicio, "o bloco de /admin existe").toBeGreaterThan(0);
  const bloco = app.slice(inicio, fim);
  return [...bloco.matchAll(/<Route\s+(index|path="([^"]+)")/g)].map((m) => (m[1] === "index" ? "" : m[2])).filter((r) => r !== "/admin");
}

const recepcao = (tipoOrganizacao = "academia"): ContextoPainel => ({ tipoOrganizacao, especialidade: null, papel: "recepcao", adminArke: false });

/** O que continua no modo essencial: o atendimento individual do aluno no balcão. */
const CONTINUA = ["", "dashboard", "alunos", "checkin-qr", "catracas", "mensagens", "agenda", "perfil", "ajuda", "ajuda/:slug"];

describe("modo essencial: toda rota do painel classificada", () => {
  it("toda rota de /admin do App.tsx está na lista, e a lista não tem rota velha", () => {
    const noApp = rotasDoAdminNoApp();
    expect(noApp.length, "o detector detecta").toBeGreaterThan(20);
    expect(noApp.filter((r) => !(r in NO_MODO_ESSENCIAL)), "rota sem classificação em NO_MODO_ESSENCIAL").toEqual([]);
    expect(Object.keys(NO_MODO_ESSENCIAL).filter((r) => !noApp.includes(r)), "rota que saiu do App.tsx").toEqual([]);
    // A mesma tabela do papel (acessoPainel.ts): as duas andam juntas.
    expect(Object.keys(NO_MODO_ESSENCIAL).sort()).toEqual(Object.keys(ROTAS_DO_PAINEL).sort());
  });

  it("o que continua é o atendimento do balcão, e só ele", () => {
    const continua = Object.entries(NO_MODO_ESSENCIAL)
      .filter(([, s]) => s === "continua")
      .map(([r]) => r)
      .sort();
    expect(continua).toEqual([...CONTINUA].sort());
    for (const rota of ["funil", "comunicados", "engajamento", "alunos/importar", "gestao-360", "relatorio-semanal", "financeiro", "equipe", "organizacao", "configuracoes/integracoes", "onboarding"]) {
      expect(abreNoModoEssencial(`/admin/${rota}`), rota).toBe(false);
    }
    expect(abreNoModoEssencial("/admin/rota-que-ninguem-classificou"), "falha fechada").toBe(false);
  });

  it("toda rota que continua abre para a recepção pelo papel", () => {
    for (const rota of CONTINUA) {
      const contexto = rota === "agenda" ? recepcao("studio") : recepcao();
      expect(ROTAS_DO_PAINEL[rota](contexto), rota).toBe(true);
    }
  });

  it("o menu da recepção no modo essencial só oferece o que abre", () => {
    for (const ehStudio of [false, true]) {
      const { secoes, pausados } = menuNoModoEssencial(
        buildSections({ ehStudio, podeGerenciarEquipe: false, podePrescreverTreino: false, podePrescreverDieta: false, alunosLabel: "Alunos" }),
      );
      const caminhos = secoes.flatMap((s) => s.items.map((i) => i.path));
      expect(caminhos.filter((p) => !abreNoModoEssencial(p)), ehStudio ? "studio" : "academia").toEqual([]);
      expect(caminhos).toContain("/admin/alunos");
      expect(pausados).toEqual(expect.arrayContaining(["Funil de Vendas", "Engajamento", "Comunicados"]));
    }
  });
});

describe("modo essencial: o painel lê o modo", () => {
  it("o portão das rotas, o menu e a faixa do topo", () => {
    const portao = ler("src", "components", "acesso", "PortaoDaRota.tsx");
    expect(portao).toMatch(/useModoEssencial\(\)/);
    expect(portao).toMatch(/modoEssencial && !abreNoModoEssencial\(pathname\)\) return <PaginaPausada \/>/);
    const menu = ler("src", "components", "layout", "AdminSidebar.tsx");
    expect(menu).toMatch(/menuNoModoEssencial\(menuCompleto\)/);
    const layout = ler("src", "components", "layout", "AdminLayout.tsx");
    expect(layout).toMatch(/\{modoEssencial && <FaixaModoEssencial \/>\}/);
  });

  it("o gate liga o modo só no caminho essencial, e a tela de suspensão segue", () => {
    const gate = ler("src", "components", "admin", "OrganizacaoBillingGate.tsx");
    expect(gate).toMatch(/decidirAcessoDoPainel\(/);
    expect(gate.match(/<ModoEssencialContext\.Provider\b/g), "um lugar só liga o modo").toHaveLength(1);
    expect(gate).toMatch(/<ModoEssencialContext\.Provider value=\{acesso\.tipo === "essencial"\}>/);
    expect(gate).toMatch(/if \(acesso\.tipo !== "bloqueio"\) \{/);
    expect(gate).toMatch(/Acesso suspenso/);
    // A decisão: a linha bloqueada (gestor, professor, nutricionista) é a suspensão, mesmo junto da essencial.
    const base = { organization_id: "o", organizacao_nome: "A", cobrancas_vencidas: 1, valor_em_aberto: 1, vencimento_mais_antigo: "2026-09-01", invoice_url: null };
    expect(decidirAcessoDoPainel([{ ...base, bloqueada: true, modo: "bloqueio" }], "o").tipo).toBe("bloqueio");
    expect(decidirAcessoDoPainel([{ ...base, bloqueada: false, modo: "essencial" }], "o").tipo).toBe("essencial");
  });

  it("o aviso da recepção não fala de dinheiro, e a faixa não tem link de fatura", () => {
    expect(AVISO_MODO_ESSENCIAL).toBe("A assinatura da academia está pendente. Algumas funções estão pausadas; fale com o gestor.");
    expect(AVISO_MODO_ESSENCIAL).not.toMatch(/R\$|valor|fatura|pag(ar|amento)/i);
    const telas = ler("src", "components", "acesso", "ModoEssencial.tsx");
    expect(telas).not.toMatch(/invoice_url|href=|valor_em_aberto/);
  });
});

// ── O banco ────────────────────────────────────────────────────────────────

const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const sqls = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8").replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "").toLowerCase());
const tudo = sqls.join("\n");

/** A última definição da função, e a posição dela no texto de todas as migrations. */
function ultimaDefinicao(): { corpo: string; fim: number } {
  const re = /create (?:or replace )?function public\.get_bloqueio_organizacao\(\)[\s\S]*?\n\$\$;/g;
  let ultima = { corpo: "", fim: -1 };
  for (const m of tudo.matchAll(re)) ultima = { corpo: m[0], fim: (m.index ?? 0) + m[0].length };
  return ultima;
}

describe("modo essencial: o banco diz o modo de cada papel", () => {
  const { corpo, fim } = ultimaDefinicao();

  it("a resposta mantém as colunas da tela publicada e acrescenta o modo no fim", () => {
    expect(corpo, "get_bloqueio_organizacao existe").not.toBe("");
    const retorno = corpo.match(/returns table \(([\s\S]*?)\)\s*language/)?.[1] ?? "";
    const colunas = retorno.split(",").map((c) => c.trim().split(/\s+/)[0]);
    expect(colunas).toEqual([
      "organization_id", "organizacao_nome", "bloqueada", "cobrancas_vencidas", "valor_em_aberto", "vencimento_mais_antigo", "invoice_url", "modo",
    ]);
  });

  it("gestor, professor e nutricionista bloqueiam; a recepção fica em modo essencial, sem número", () => {
    const corpoLimpo = corpo.replace(/\s+/g, " ");
    expect(corpoLimpo).toMatch(/om\.user_id = auth\.uid\(\)/);
    expect(corpoLimpo).toMatch(/om\.role in \('gestor', 'professor', 'nutricionista', 'recepcao'\)/);
    // A recepção nunca recebe `bloqueada` (a tela publicada a mandaria para a suspensão).
    expect(corpoLimpo).toMatch(/\(a\.inadimplente and a\.role <> 'recepcao'\),/);
    expect(corpoLimpo).toMatch(/when a\.role = 'recepcao' then 'essencial' else 'bloqueio'/);
    // Os números da cobrança só para quem não é recepção, e só a dívida (lista de inclusão).
    expect(corpoLimpo).toMatch(/join vinculos v on v\.id = c\.organization_id and v\.role <> 'recepcao'/);
    expect(corpoLimpo).toMatch(/c\.status in \('pendente', 'atrasado'\)/);
    expect(corpoLimpo).not.toMatch(/c\.status <> 'confirmado'/);
    // A ArkeFit e o trial seguem isentos.
    expect(corpoLimpo).toMatch(/has_role\(auth\.uid\(\), 'superadmin'\) or public\.has_role\(auth\.uid\(\), 'admin_arke'\)/);
    expect(corpoLimpo).toMatch(/v\.status <> 'trial' and public\.organizacao_inadimplente_b2b\(v\.id\)/);
  });

  it("recriada, a função sai sem EXECUTE para o PUBLIC e para anon", () => {
    const depois = tudo.slice(fim);
    expect(depois).toMatch(/revoke execute on function public\.get_bloqueio_organizacao\(\) from public, anon;/);
    expect(depois).toMatch(/grant execute on function public\.get_bloqueio_organizacao\(\) to authenticated, service_role;/);
  });
});
