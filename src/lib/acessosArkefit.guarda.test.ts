import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { comandosDeRegra, dividir, regrasVigentes, textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";
import {
  CHAMADAS_DA_VISAO_MASTER,
  NIVEIS_ABERTOS,
  NIVEIS_DA_AREA,
  ROTAS_DA_VISAO_MASTER,
  type AreaArkefit,
  type Chamada,
} from "./acessosArkefit";

/**
 * Os níveis da equipe da ArkeFit (08/10/2026; entrega 1: a base, o Mentor e o
 * Suporte; entrega 2: o Comercial, o Financeiro e a limpeza). A equipe
 * contratada entra na Visão Master com um nível
 * (`equipe_arkefit.niveis`), e cada nível abre áreas; o Sócio abre todas. A
 * pergunta mora no banco, `acesso_arkefit(área)`, e o app tem o espelho em
 * `src/lib/acessosArkefit.ts`.
 *
 * Esta guarda falha se:
 *   1. uma rota de /superadmin do App.tsx não disser que área a abre (ou a
 *      tabela tiver rota que saiu), ou se o portão sair do layout;
 *   2. uma chamada ao banco das telas da Visão Master (e das libs e dos
 *      componentes que elas usam) não estiver no mapa das chamadas (fechado);
 *   3. a última definição de uma função do mapa não conferir a área dela
 *      (`acesso_arkefit('<área>')`; no Método, `equipe_metodo()`; no Sócio, o
 *      papel `superadmin`), ou aceitar o `admin_arke` como alternativa na
 *      conferência, salvo com o motivo escrito no mapa;
 *   4. uma função `get_superadmin_*` ficar fora do mapa;
 *   5. o `case` de `acesso_arkefit` divergir de `NIVEIS_DA_AREA`, ou os
 *      níveis abertos do banco divergirem dos do app;
 *   6. uma função publicada do mapa (sem motivo) não perguntar a área ao banco
 *      (`acessoArkefit(`) com a sessão verificada (`verificada(`);
 *   7. o convite de nível gravar `user_roles` (só o Sócio ganha papel).
 * E cobra o termo do Mentor nas regras: sempre com o aluno do Método. Na
 * entrega 2: o `case` de `emails_da_area` é o mesmo; `plataforma_config` tem
 * uma regra por operação, e o Financeiro e o Comercial leem só as chaves
 * deles; a escrita de `organizations` continua do Sócio (e do gestor), e as
 * travas das colunas aceitam o Financeiro só no dinheiro, depois de deixar
 * passar quem não tem usuário (o aviso do Asaas, as rotinas); e nenhuma regra
 * chama `equipe_metodo()` linha a linha.
 */
const RAIZ = join(__dirname, "..", "..");
const SRC = join(RAIZ, "src");
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), "utf8").replace(/\r\n/g, "\n");
const textos = textosDaReconstrucao().map((t: string) => t.replace(/\r\n/g, "\n"));

// ── Ajudantes ──────────────────────────────────────────────────────────────

/** As rotas filhas de /superadmin no App.tsx. */
function rotasDaVisaoMasterNoApp(app: string): string[] {
  const inicio = app.indexOf('path="/superadmin"');
  expect(inicio, "o bloco de /superadmin existe").toBeGreaterThan(0);
  const fim = app.indexOf('<Route path="*"', inicio);
  const bloco = app.slice(inicio, fim < 0 ? undefined : fim);
  return [...bloco.matchAll(/<Route\s+(index|path="([^"]+)")/g)].map((m) => (m[1] === "index" ? "" : m[2])).filter((r) => r !== "/superadmin");
}

/** O código sem comentários de bloco e sem linhas só de comentário. */
const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function resolverImportacao(de: string, caminho: string): string | null {
  let base: string;
  if (caminho.startsWith("@/")) base = join(SRC, caminho.slice(2));
  else if (caminho.startsWith(".")) base = join(dirname(de), caminho);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/**
 * As telas da Visão Master e tudo o que elas importam do app, menos a sessão
 * de todo mundo (`src/contexts/`), os componentes de interface e o cliente.
 */
function fechoDaVisaoMaster(): string[] {
  const inicio = [
    ...readdirSync(join(SRC, "pages", "superadmin"))
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .map((f) => join(SRC, "pages", "superadmin", f)),
    join(SRC, "components", "layout", "SuperAdminLayout.tsx"),
    join(SRC, "components", "layout", "SuperAdminSidebar.tsx"),
  ];
  const vistos = new Set<string>();
  const fila = [...inicio];
  while (fila.length) {
    const arquivo = fila.pop()!;
    if (vistos.has(arquivo)) continue;
    vistos.add(arquivo);
    const codigo = readFileSync(arquivo, "utf8");
    for (const m of codigo.matchAll(/(?:import|export)\s[^;]*?from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g)) {
      const caminho = m[1] ?? m[2];
      if (/^@\/(components\/ui|integrations|contexts)\//.test(caminho)) continue;
      const r = resolverImportacao(arquivo, caminho);
      if (r && !r.includes(".test.")) fila.push(r);
    }
  }
  return [...vistos];
}

const CHAMADA_RE = /\.storage\s*\.from\(\s*"([^"]+)"|\.rpc\(\s*"([^"]+)"|\.functions\.invoke(?:<[^>]*>)?\(\s*"([^"]+)"|\.from\(\s*"([^"]+)"/g;

/** As chamadas ao banco de um código: `rpc:x`, `fn:x`, `from:x`, `storage:x`. */
function chamadasDe(codigo: string): string[] {
  const achadas = new Set<string>();
  for (const m of semComentarios(codigo).matchAll(CHAMADA_RE)) {
    achadas.add(m[1] ? `storage:${m[1]}` : m[2] ? `rpc:${m[2]}` : m[3] ? `fn:${m[3]}` : `from:${m[4]}`);
  }
  return [...achadas];
}

/** A última definição de uma função nos textos (até o fim do corpo), ou "". */
function ultimaDefinicao(nome: string, sqls: string[] = textos): string {
  const re = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?${nome}\s*\(`, "gi");
  let ultima = "";
  for (const t of sqls) {
    for (const m of t.matchAll(re)) {
      const resto = t.slice(m.index);
      const marca = /\bas\s+(\$[a-z_]*\$)/i.exec(resto);
      if (!marca) continue;
      const fim = resto.indexOf(marca[1], marca.index + marca[0].length);
      ultima = resto.slice(0, fim + marca[1].length);
    }
  }
  return ultima;
}

/**
 * A conferência de quem chama: a condição do primeiro `if ... then raise`
 * que pergunta por papel ou área (antes dela pode vir "aluno não
 * encontrado"). Sem nenhuma, o corpo até a primeira recusa.
 */
function conferenciaDe(definicao: string): string {
  const corpo = definicao.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
  const depois = corpo.slice(Math.max(corpo.search(/\bas \$[a-z_]*\$/), 0));
  for (const m of depois.matchAll(/\bif (.*?) then raise exception/g)) {
    if (/has_role|acesso_arkefit|equipe_metodo|is_org_staff|has_org_role|atende_saude|cuida_do_dinheiro/.test(m[1])) return m[1];
  }
  const recusa = depois.search(/raise exception/);
  return recusa < 0 ? depois : depois.slice(0, recusa);
}

/** O que falta na conferência da área de uma função, ou "" se está certa. */
function problemaNaConferencia(rpc: string, area: AreaArkefit, definicao: string): string {
  if (!definicao) return `${rpc}: a definição não foi achada`;
  const c = conferenciaDe(definicao);
  const aceitas =
    area === "socio"
      ? [/has_role\((auth\.uid\(\)|v_uid|v_ator), 'superadmin'/, /acesso_arkefit\('socio'\)/]
      : area === "mentoria"
        ? [/acesso_arkefit\('mentoria'\)/, /equipe_metodo\(\)/]
        : [new RegExp(`acesso_arkefit\\('${area}'\\)`)];
  if (!aceitas.some((re) => re.test(c))) return `${rpc}: não confere a área ${area}`;
  if (/admin_arke/.test(c)) return `${rpc}: aceita o admin_arke na conferência`;
  return "";
}

/** O `case` de acesso_arkefit: área → níveis. */
function casoDoBanco(definicao: string): Record<string, string[]> {
  const caso: Record<string, string[]> = {};
  for (const m of definicao.matchAll(/when\s+'(\w+)'\s+then\s+array\[([^\]]*)\]/g)) {
    caso[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
  }
  return caso;
}

/** O que o convite gravado faz de errado com papel e nível. */
function problemasDoConvite(definicao: string): string[] {
  const d = definicao.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
  const problemas: string[] = [];
  if (!/if \(cardinality\(v_papeis\) = 0\) = \(cardinality\(v_niveis\) = 0\) then raise exception/.test(d)) {
    problemas.push("aceita papel e nível juntos, ou nenhum dos dois");
  }
  if (!/if not \(v_niveis <@ public\.niveis_arkefit_abertos\(\)\) then raise exception/.test(d)) problemas.push("dá nível que não está no ar");
  const insercoes = [...d.matchAll(/insert into public\.user_roles[^;]*;/g)].map((m) => m[0]);
  if (insercoes.length !== 1 || !/select _user_id, p from unnest\(v_papeis\) p on conflict/.test(insercoes[0] ?? "")) {
    problemas.push("grava user_roles com outra coisa além dos papéis do Sócio");
  }
  return problemas;
}

// ── 1. As rotas ────────────────────────────────────────────────────────────

describe("as rotas da Visão Master dizem a área que as abre", () => {
  const app = ler("src", "App.tsx");

  it("toda rota de /superadmin está na tabela, e a tabela não tem rota velha", () => {
    const noApp = rotasDaVisaoMasterNoApp(app);
    expect(noApp.length, "o detector detecta").toBeGreaterThan(15);
    expect(noApp.filter((r) => !(r in ROTAS_DA_VISAO_MASTER)), "falta em ROTAS_DA_VISAO_MASTER").toEqual([]);
    expect(Object.keys(ROTAS_DA_VISAO_MASTER).filter((r) => !noApp.includes(r)), "rota que saiu do App.tsx").toEqual([]);
  });

  it("a porta é o PortaoVisaoMaster (as duas etapas sempre), e o layout passa cada página pelo portão da rota", () => {
    const bloco = app.slice(app.indexOf('path="/superadmin"'), app.indexOf('path="/superadmin"') + 300);
    expect(bloco).toMatch(/<PortaoVisaoMaster>\s*<SuperAdminLayout \/>\s*<\/PortaoVisaoMaster>/);
    expect(ler("src", "components", "acesso", "PortaoVisaoMaster.tsx")).toMatch(/<VerificacaoDuasEtapas[^>]*>\{children\}<\/VerificacaoDuasEtapas>/);
    expect(ler("src", "components", "layout", "SuperAdminLayout.tsx")).toMatch(
      /<PortaoDaRotaVisaoMaster>\s*<Outlet \/>\s*<\/PortaoDaRotaVisaoMaster>/,
    );
    expect(ler("src", "components", "layout", "SuperAdminSidebar.tsx")).toMatch(/podeAbrirNaVisaoMaster\(i\.path, acesso\)/);
  });

  it("o detector acha a rota nova sem área (a trava trava)", () => {
    const comNova = app.replace('<Route path="equipe" element={<SuperAdminEquipe />} />', '<Route path="equipe" element={<SuperAdminEquipe />} />\n<Route path="financas" element={<div />} />');
    expect(rotasDaVisaoMasterNoApp(comNova).filter((r) => !(r in ROTAS_DA_VISAO_MASTER))).toEqual(["financas"]);
  });
});

// ── 2. As chamadas ─────────────────────────────────────────────────────────

describe("toda chamada ao banco da Visão Master está no mapa, com a área", () => {
  const fecho = fechoDaVisaoMaster();
  const porArquivo = fecho.map((a) => ({ arquivo: relative(RAIZ, a).replace(/\\/g, "/"), chamadas: chamadasDe(readFileSync(a, "utf8")) }));
  const todas = new Set(porArquivo.flatMap((p) => p.chamadas));

  it("o detector detecta (o fecho tem as telas e as libs que elas usam)", () => {
    expect(fecho.length).toBeGreaterThan(60);
    expect(todas.has("rpc:get_superadmin_tenants")).toBe(true);
    expect(todas.has("fn:superadmin-suporte-tenant")).toBe(true);
    expect(todas.has("from:mensagens_mentor")).toBe(true);
  });

  it("nenhuma chamada fora do mapa (fechado)", () => {
    const fora = porArquivo.flatMap((p) => p.chamadas.filter((c) => !(c in CHAMADAS_DA_VISAO_MASTER)).map((c) => `${p.arquivo}: ${c}`));
    expect(fora, "diga a área em CHAMADAS_DA_VISAO_MASTER (src/lib/acessosArkefit.ts)").toEqual([]);
  });

  it("o mapa não guarda chamada que nenhuma tela faz mais", () => {
    expect(Object.keys(CHAMADAS_DA_VISAO_MASTER).filter((c) => !todas.has(c))).toEqual([]);
  });

  it("o detector acha a chamada nova, e ignora a que está em comentário (a trava trava)", () => {
    expect(chamadasDe('await supabase.rpc("get_superadmin_financas", {})')).toEqual(["rpc:get_superadmin_financas"]);
    expect(chamadasDe('/** exemplo: supabase.from("x") */\n// supabase.rpc("y")\nconst a = 1;')).toEqual([]);
    expect(chamadasDe('supabase.functions.invoke<{ ok: boolean }>(\n  "nova-funcao", {})')).toEqual(["fn:nova-funcao"]);
  });
});

// ── 3 e 4. A conferência no banco ──────────────────────────────────────────

describe("cada função do mapa confere a área no banco", () => {
  const rpcs = Object.entries(CHAMADAS_DA_VISAO_MASTER).filter(([c]) => c.startsWith("rpc:")) as [string, Chamada][];

  it("a última definição confere a área, sem o admin_arke como alternativa (salvo o motivo)", () => {
    const problemas = rpcs
      .filter(([, c]) => !c.motivo && c.area !== "todos")
      .map(([c, { area }]) => problemaNaConferencia(c, area as AreaArkefit, ultimaDefinicao(c.slice(4))))
      .filter(Boolean);
    expect(problemas).toEqual([]);
  });

  it("toda função get_superadmin_* do banco está no mapa", () => {
    const tipos = ler("src", "integrations", "supabase", "types.ts");
    const funcoes = [...new Set([...tipos.matchAll(/^ {6}(get_superadmin_\w+): \{/gm)].map((m) => m[1]))];
    expect(funcoes.length, "o detector detecta").toBeGreaterThan(20);
    expect(funcoes.filter((f) => !(`rpc:${f}` in CHAMADAS_DA_VISAO_MASTER))).toEqual([]);
  });

  it("o leitor acha a conferência errada (a trava trava)", () => {
    const definicao = ultimaDefinicao("get_superadmin_tenants");
    expect(problemaNaConferencia("rpc:get_superadmin_tenants", "carteira", definicao)).toBe("");
    const comAdmin = definicao.replace(
      "if not public.acesso_arkefit('carteira') then",
      "if not (public.acesso_arkefit('carteira') or public.has_role(auth.uid(), 'admin_arke')) then",
    );
    expect(problemaNaConferencia("rpc:get_superadmin_tenants", "carteira", comAdmin)).toMatch(/admin_arke/);
    const outraArea = definicao.replace("acesso_arkefit('carteira')", "acesso_arkefit('suporte')");
    expect(problemaNaConferencia("rpc:get_superadmin_tenants", "carteira", outraArea)).toMatch(/não confere a área carteira/);
    // O texto antigo (só o superadmin) não serve à carteira: o Suporte ficaria de fora.
    const antiga = ultimaDefinicao("get_superadmin_tenants", textos.filter((t) => !t.includes("Os níveis da equipe da ArkeFit, lote 4")));
    expect(problemaNaConferencia("rpc:get_superadmin_tenants", "carteira", antiga)).toMatch(/não confere/);
  });
});

// ── 5. O case de acesso_arkefit e os níveis abertos ────────────────────────

describe("o banco e o app dizem o mesmo sobre as áreas e os níveis", () => {
  const acesso = ultimaDefinicao("acesso_arkefit");

  it("o case de acesso_arkefit é NIVEIS_DA_AREA", () => {
    expect(acesso, "a definição foi achada").not.toBe("");
    const doApp = Object.fromEntries(Object.entries(NIVEIS_DA_AREA).map(([a, n]) => [a, [...n].sort()]));
    expect(casoDoBanco(acesso)).toEqual(doApp);
  });

  it("acesso_arkefit: security definer, o Sócio por has_role, o nível só com aal2, ativo e fora de sessão simulada", () => {
    const d = acesso.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
    expect(d).toMatch(/security definer/);
    expect(d).toMatch(/raise exception 'área desconhecida: %'[^;]*errcode = '22023'/);
    expect(d).toMatch(/if public\.has_role\(auth\.uid\(\), 'superadmin'\) then return true;/);
    expect(d).toMatch(/if coalesce\(\(select auth\.jwt\(\)\) ->> 'aal', ''\) <> 'aal2' then return false;/);
    expect(d).toMatch(/e\.user_id = auth\.uid\(\) and e\.ativo and e\.niveis && v_niveis/);
    expect(d).toMatch(/and not public\.sessao_simulada\(\)/);
  });

  it("os níveis abertos do banco são os do app", () => {
    const abertos = ultimaDefinicao("niveis_arkefit_abertos");
    expect([...abertos.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...NIVEIS_ABERTOS].sort());
  });

  it("o case de emails_da_area (os avisos por área) também é NIVEIS_DA_AREA", () => {
    const emails = ultimaDefinicao("emails_da_area");
    expect(emails, "a definição foi achada").not.toBe("");
    const doApp = Object.fromEntries(Object.entries(NIVEIS_DA_AREA).map(([a, n]) => [a, [...n].sort()]));
    expect(casoDoBanco(emails)).toEqual(doApp);
    const d = emails.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
    // A equipe contratada só com a conta pronta (senha e duas etapas) e ativa.
    expect(d).toMatch(/e\.ativo and e\.niveis && v_niveis/);
    expect(d).toMatch(/estado_conta_arkefit\(u\.id\) = 'ativo'/);
  });

  it("o leitor acha o case que diverge (a trava trava)", () => {
    const divergente = acesso.replace("when 'operacao'   then array['suporte']", "when 'operacao'   then array['suporte', 'mentor']");
    expect(casoDoBanco(divergente).operacao).toEqual(["mentor", "suporte"]);
    expect(casoDoBanco(divergente)).not.toEqual(Object.fromEntries(Object.entries(NIVEIS_DA_AREA).map(([a, n]) => [a, [...n].sort()])));
  });
});

// ── 6. As funções publicadas ───────────────────────────────────────────────

/** O que falta numa função publicada para conferir a área, ou "". */
function problemaNaFuncao(nome: string, area: AreaArkefit, codigo: string): string {
  if (!codigo) return `${nome}: o código não foi achado`;
  if (!/verificada\(/.test(codigo)) return `${nome}: sem a sessão verificada`;
  // A área vai literal na chamada, ou numa variável escolhida pela ação (o token e o resto).
  const perguntaArea = /acessoArkefit\(/.test(codigo) && codigo.includes(`"${area}"`);
  if (area === "socio") {
    return perguntaArea || /role\s*===\s*"superadmin"/.test(codigo) ? "" : `${nome}: não confere o Sócio`;
  }
  return perguntaArea ? "" : `${nome}: não pergunta a área ${area} ao banco (acessoArkefit)`;
}

describe("as funções publicadas do mapa perguntam a área ao banco, com a sessão verificada", () => {
  const funcoes = Object.entries(CHAMADAS_DA_VISAO_MASTER).filter(([c, d]) => c.startsWith("fn:") && !d.motivo);
  const codigo = (nome: string) => {
    const caminho = join(RAIZ, "supabase", "functions", nome, "index.ts");
    return existsSync(caminho) ? ler("supabase", "functions", nome, "index.ts") : "";
  };

  it("cada uma tem acessoArkefit( e verificada(", () => {
    expect(funcoes.length, "o detector detecta").toBeGreaterThanOrEqual(4);
    const problemas = funcoes.map(([c, d]) => problemaNaFuncao(c.slice(3), d.area as AreaArkefit, codigo(c.slice(3)))).filter(Boolean);
    expect(problemas).toEqual([]);
  });

  it("superadmin-suporte-tenant: o token é da operação; o e-mail do gestor e excluir, do Sócio", () => {
    const c = codigo("superadmin-suporte-tenant");
    expect(c).toMatch(/const area = acao === "resetar_token_gateway" \? "operacao" : "socio";/);
    expect(c).toMatch(/verificada\(claimsData\?\.claims\) \? await acessoArkefit\(asUser, claimsData\?\.claims, area\) : false/);
  });

  it("criar a academia: o cadastro cria só ativa; o trial pede o Sócio", () => {
    const c = codigo("criar-organizacao-superadmin");
    expect(c).toMatch(/if \(status === "trial"\) \{\s*const socio = await acessoArkefit\(asUser, claimsData\?\.claims, "socio"\);/);
    expect(c.indexOf('acessoArkefit(asUser, claimsData?.claims, "socio")')).toBeLessThan(c.indexOf('.from("organizations")'));
  });

  it("a conta das cobranças e a mensalidade B2B: o ramo da ArkeFit é o financeiro; o do gestor não muda", () => {
    for (const nome of ["asaas-conta-academia", "asaas-assinatura-b2b"]) {
      const c = codigo(nome);
      expect(c, nome).toMatch(/acessoArkefit\(asUser, claims\?\.claims, "financeiro"\)/);
      expect(c, nome).toMatch(/if \(!arkefit && vinculo\?\.role !== "gestor"\)/);
      expect(c, nome).not.toMatch(/role === "admin_arke"/);
    }
  });

  it("a conversa e o Sentinela conferem o aluno do Método", () => {
    expect(codigo("mentor-sugerir-resposta")).toMatch(/if \(aluno\.metodo_arke_status !== "ativo"\) return jsonResponse\(/);
    expect(codigo("sentinela-anamnese")).toMatch(/if \(noMetodo \? !arkefit : !equipe\)/);
  });

  it("o leitor acha a função que perdeu a pergunta (a trava trava)", () => {
    const c = codigo("mentor-sugerir-resposta");
    expect(problemaNaFuncao("mentor-sugerir-resposta", "mentoria", c)).toBe("");
    expect(problemaNaFuncao("mentor-sugerir-resposta", "mentoria", c.replace(/acessoArkefit\(asUser, claims\?\.claims, "mentoria"\)/, "true"))).toMatch(
      /não pergunta a área/,
    );
    expect(problemaNaFuncao("mentor-sugerir-resposta", "mentoria", c.replace(/verificada\(/g, "aceita("))).toMatch(/sessão verificada/);
  });
});

// ── 7. O convite de nível não grava user_roles ─────────────────────────────

describe("nível nunca grava user_roles: só o Sócio ganha papel", () => {
  const gravar = ultimaDefinicao("gravar_convite_equipe_arkefit");
  const funcao = ler("supabase", "functions", "equipe-arkefit-convidar", "index.ts");

  it("o convite gravado no banco: papel ou nível, nunca os dois; nível só aberto; user_roles só com os papéis", () => {
    expect(gravar, "a definição foi achada").not.toBe("");
    expect(problemasDoConvite(gravar)).toEqual([]);
  });

  it("a função manda papéis só no convite do Sócio, e não escreve em user_roles", () => {
    expect(funcao).toMatch(/const conviteDeSocio = "acesso" in pedido;/);
    expect(funcao).toMatch(/_papeis: conviteDeSocio \? \[\.\.\.pedido\.acesso\.papeis\] : \[\],/);
    expect(funcao).toMatch(/_niveis: conviteDeSocio \? \[\] : pedido\.niveis,/);
    expect(funcao).not.toMatch(/from\("user_roles"\)\s*\.(insert|upsert|update|delete)\(/);
  });

  it("salvar a equipe também não grava user_roles", () => {
    const salvar = ultimaDefinicao("salvar_equipe_arkefit").replace(/--[^\n]*/g, "");
    expect(salvar).not.toBe("");
    expect(salvar).not.toMatch(/insert into public\.user_roles/i);
    expect(salvar).toMatch(/not \(v_niveis <@ public\.niveis_arkefit_abertos\(\)\)/);
  });

  it("o leitor acha o convite que dá papel ao nível (a trava trava)", () => {
    expect(problemasDoConvite(gravar.replace("from unnest(v_papeis) p", "from unnest(v_papeis || 'admin_arke'::public.app_role) p"))).toContain(
      "grava user_roles com outra coisa além dos papéis do Sócio",
    );
    expect(problemasDoConvite(gravar.replace("if (cardinality(v_papeis) = 0) = (cardinality(v_niveis) = 0) then", "if false then"))).toContain(
      "aceita papel e nível juntos, ou nenhum dos dois",
    );
  });
});

// ── O dinheiro e a configuração (entrega 2) ────────────────────────────────

const CHAVES_DO_FINANCEIRO = ["taxa_implantacao_referencia", "taxa_processamento_fixa", "taxa_processamento_minima", "taxa_processamento_percentual"];
const CHAVES_DO_COMERCIAL = ["agente_comercial_ativo", "agente_comercial_ia", "agente_comercial_outras_origens"];

/** Os problemas das regras de `plataforma_config`. */
function problemasDaConfiguracao(sqls: string[] = textos): string[] {
  const problemas: string[] = [];
  const regras = [...regrasVigentes(sqls, "public.plataforma_config")].filter(([, r]) => !r.restritiva);
  const comandos = regras.map(([, r]) => r.comando).sort();
  if (comandos.join() !== "delete,insert,select,update") problemas.push(`uma regra por operação, sem FOR ALL: ${comandos.join()}`);
  for (const [nome, r] of regras) {
    for (const [metade, expr] of [["using", r.using], ["with check", r.withCheck]] as const) {
      if (!expr) continue;
      for (const termo of dividir(expr, "or")) {
        if (/acesso_arkefit\('socio'\)/.test(termo) && !/acesso_arkefit\('(?!socio)/.test(termo)) continue;
        const area = /acesso_arkefit\('(\w+)'\)/.exec(termo)?.[1];
        const chaves = [...(/chave in \(([^)]*)\)/.exec(termo)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
        const esperadas = area === "financeiro" ? CHAVES_DO_FINANCEIRO : area === "comercial" ? CHAVES_DO_COMERCIAL : null;
        if (r.comando !== "select" || !esperadas || chaves.join() !== esperadas.join()) {
          problemas.push(`"${nome}" (${metade}): ${termo}`);
        }
      }
    }
  }
  return problemas;
}

/** O corpo de uma função sem comentários, numa linha, em minúsculas. */
const corpo = (nome: string) => ultimaDefinicao(nome).replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();

describe("o dinheiro: o Financeiro lê e grava pelas funções; a escrita direta segue do Sócio", () => {
  it("plataforma_config: uma regra por operação; o Financeiro lê só as chaves de dinheiro, o Comercial só as da Letícia, e gravar é do Sócio", () => {
    expect(problemasDaConfiguracao()).toEqual([]);
  });

  it("a escrita de organizations continua do Sócio (e do gestor): nenhuma área entra nas regras de gravação", () => {
    const gravacao = [...regrasVigentes(textos, "public.organizations")].filter(([, r]) => !r.restritiva && r.comando !== "select");
    expect(gravacao.length, "o detector detecta").toBeGreaterThan(0);
    const comArea = gravacao.filter(([, r]) => /acesso_arkefit/.test(`${r.using ?? ""} ${r.withCheck ?? ""}`)).map(([n]) => n);
    expect(comArea).toEqual([]);
  });

  it("a trava das colunas da academia: sem usuário passa primeiro; o Financeiro só no dinheiro", () => {
    const d = corpo("proteger_colunas_organizacao");
    expect(d.indexOf("if v_uid is null then return new; end if;"), "sem usuário passa primeiro").toBeGreaterThan(0);
    expect(d.indexOf("if v_uid is null then return new; end if;")).toBeLessThan(d.indexOf("acesso_arkefit"));
    const financeiro = [...d.matchAll(/if ([^;]*?) then raise exception/g)].filter((m) => m[1].includes("acesso_arkefit('financeiro')"));
    expect(financeiro).toHaveLength(1);
    const colunas = [...financeiro[0][1].matchAll(/new\.(\w+) is distinct from/g)].map((m) => m[1]).sort();
    expect(colunas).toEqual(["limite_alunos", "plano_b2b", "repasse_tipo", "repasse_valor", "valor_mensal_b2b"]);
    // A marca de fictícia, a assinatura B2B no Asaas e a conta seguem fora do alcance do Financeiro.
    expect(d).toMatch(/if new\.ficticia is distinct from old\.ficticia[^;]*then raise exception/);
  });

  it("a trava da exceção de repasse por nível: sem usuário passa primeiro; o Financeiro passa", () => {
    const d = corpo("proteger_repasse_por_nivel");
    expect(d).toMatch(/if v_uid is null or public\.has_role\(v_uid, 'superadmin'\)/);
    expect(d).toMatch(/if not public\.acesso_arkefit\('financeiro'\) then raise exception/);
  });

  it("as três funções do dinheiro deixam a trilha na Auditoria", () => {
    expect(corpo("definir_mensalidade_b2b")).toMatch(/registrar_auditoria\([^;]*'organizacao\.mensalidade_b2b_definida'/);
    expect(corpo("definir_repasse_organizacao")).toMatch(/registrar_auditoria\([^;]*'repasse_metodo\.definido'/);
    expect(corpo("definir_repasse_por_nivel")).toMatch(/registrar_auditoria\([^;]*'repasse_metodo\.excecao_definida'/);
  });

  it("o leitor acha a configuração aberta demais (a trava trava)", () => {
    const aberta = [...textos, `alter policy "leitura" on public.plataforma_config using ((select public.acesso_arkefit('socio')) or (select public.acesso_arkefit('financeiro')));`];
    expect(problemasDaConfiguracao(aberta).length).toBe(1);
    const outraChave = [
      ...textos,
      `alter policy "leitura" on public.plataforma_config using ((select public.acesso_arkefit('socio')) or (chave in ('taxa_implantacao_referencia', 'taxa_processamento_fixa', 'taxa_processamento_minima', 'taxa_processamento_percentual', 'exigir_registro_metodo') and (select public.acesso_arkefit('financeiro'))));`,
    ];
    expect(problemasDaConfiguracao(outraChave).length).toBe(1);
    const gravaFinanceiro = [...textos, `alter policy "alteração" on public.plataforma_config using ((select public.acesso_arkefit('financeiro')));`];
    expect(problemasDaConfiguracao(gravaFinanceiro).length).toBe(1);
  });
});

/** As expressões das regras vigentes que chamam equipe_metodo() linha a linha (sem o `(select ...)`). */
function equipeMetodoSolto(sqls: string[] = textos): string[] {
  const tabelas = new Set<string>();
  for (const t of sqls) for (const c of comandosDeRegra(t)) tabelas.add(c.tabela);
  const soltos: string[] = [];
  for (const tabela of tabelas) {
    let regras;
    try {
      regras = regrasVigentes(sqls, tabela);
    } catch {
      continue; // a tabela criada fora do retrato (o resumo da anamnese): o roteiro de produção confere
    }
    for (const [nome, r] of regras) {
      for (const [metade, expr] of [["using", r.using], ["with check", r.withCheck]] as const) {
        const sem = String(expr ?? "").replace(/\(\s*select\s+(?:public\.)?equipe_metodo\(\)\s*\)/gi, "");
        if (/equipe_metodo\(\)/.test(sem)) soltos.push(`${tabela} "${nome}" (${metade})`);
      }
    }
  }
  return soltos;
}

describe("equipe_metodo() uma vez por consulta", () => {
  it("nenhuma regra o chama linha a linha", () => {
    expect(equipeMetodoSolto()).toEqual([]);
  });

  it("o leitor acha a regra nova que o chama solto (a trava trava)", () => {
    const solta = [...textos, `alter policy "leitura" on public.treinos using (public.equipe_metodo() and public.aluno_no_metodo(aluno_id));`];
    expect(equipeMetodoSolto(solta)).toEqual(['public.treinos "leitura" (using)']);
  });
});

// ── O termo do Mentor nas regras ───────────────────────────────────────────

/** Os termos (ligados por OU) que abrem a tabela ao Mentor sem o aluno do Método. */
function termosDoMentorSoltos(tabela: string, sqls: string[] = textos): string[] {
  const soltos: string[] = [];
  for (const [nome, r] of regrasVigentes(sqls, `public.${tabela}`)) {
    for (const [metade, expr] of [["using", r.using], ["with check", r.withCheck]] as const) {
      if (!expr) continue;
      for (const termo of dividir(expr, "or")) {
        if (!termo.includes("acesso_arkefit('mentoria')")) continue;
        const condicoes = dividir(termo, "and");
        const metodo = condicoes.some((c: string) => /aluno_no_metodo\(aluno_id\)/.test(c));
        const dono = tabela !== "tarefas" || condicoes.includes("dono = 'arkefit'");
        if (!metodo || !dono) soltos.push(`${tabela} "${nome}" (${metade}): ${termo}`);
      }
    }
  }
  return soltos;
}

describe("o Mentor só alcança o aluno do Método", () => {
  const TABELAS = ["tarefas", "mensagens_mentor", "sentinela_sugestoes", "aluno_consentimento_ia", "aluno_fase_historico"];

  it("todo termo do Mentor pede o aluno do Método (e, nas tarefas, só as da ArkeFit)", () => {
    for (const t of TABELAS) {
      const regras = [...regrasVigentes(textos, `public.${t}`).values()];
      expect(
        regras.some((r) => `${r.using ?? ""} ${r.withCheck ?? ""}`.includes("acesso_arkefit('mentoria')")),
        `${t} tem o termo do Mentor`,
      ).toBe(true);
      expect(termosDoMentorSoltos(t)).toEqual([]);
    }
  });

  it("uma regra por operação nas tabelas do Mentor", () => {
    for (const t of TABELAS) {
      const permissivas = [...regrasVigentes(textos, `public.${t}`)].filter(([, r]) => !r.restritiva);
      const porComando = permissivas.map(([, r]) => r.comando);
      expect(new Set(porComando).size, t).toBe(porComando.length);
    }
  });

  it("o leitor acha o termo do Mentor sem o aluno do Método (a trava trava)", () => {
    const solta = [
      ...textos,
      `alter policy "leitura" on public.mensagens_mentor using ((select public.acesso_arkefit('mentoria')));`,
      `alter policy "leitura" on public.tarefas using ((select public.acesso_arkefit('mentoria')) and aluno_id is not null and public.aluno_no_metodo(aluno_id));`,
    ];
    expect(termosDoMentorSoltos("mensagens_mentor", solta)).toHaveLength(1);
    expect(termosDoMentorSoltos("tarefas", solta)).toHaveLength(1);
  });
});
