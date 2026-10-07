import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Trava da acessibilidade (auditoria de 05/10/2026), em quatro regras:
 *
 * 1. o texto tem contraste AA (4,5:1 no texto pequeno) nos dois temas — o
 *    dourado como texto dava 2,06:1 no claro, o cinza do texto secundário
 *    4,24:1, o branco sobre o dourado do hover 3,02:1 e o vermelho como texto
 *    2,97:1 no escuro;
 * 2. a tela pode ser ampliada: `user-scalable=no` impedia o zoom de quem
 *    enxerga mal;
 * 3. botão só de ícone tem nome (eram 31 de 77 sem);
 * 4. o "carregando" de tela inteira se anuncia (`role="status"`).
 */
const RAIZ = join(__dirname, "..", "..");
const SRC = join(RAIZ, "src");

/**
 * Botões só de ícone sem nome acessível, num arquivo `.tsx`.
 *
 * Um `<Button>` (ou `<button>`) cujo conteúdo é só ícone é lido pelo leitor de
 * tela como "botão", sem dizer o quê. Na auditoria de 05/10/2026 eram 31 de
 * 77 — entre eles o menu do app do aluno, o enviar do chat e o tema. O nome
 * vem de `aria-label`, `aria-labelledby`, `title` ou de um texto dentro
 * (inclusive o `sr-only`).
 *
 * Usa o compilador do TypeScript, e não expressão regular: `onClick={() =>
 * ...}` tem um `>` no meio da tag e enganava a busca por texto.
 */
export function botoesSemRotulo(codigo: string, arquivo = "x.tsx"): { linha: number; trecho: string }[] {
  const fonte = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achados: { linha: number; trecho: string }[] = [];

  const nomeDaTag = (n: ts.JsxTagNameExpression) => n.getText(fonte);
  const atributos = (a: ts.JsxAttributes) =>
    a.properties.filter(ts.isJsxAttribute).map((p) => p.name.getText(fonte));

  /** "texto" (tem nome), "icone" (só ícone) ou "vazio". */
  function conteudo(filhos: readonly ts.JsxChild[]): "texto" | "icone" | "vazio" {
    let icone = false;
    for (const f of filhos) {
      if (ts.isJsxText(f)) {
        if (f.getText(fonte).trim()) return "texto";
      } else if (ts.isJsxExpression(f)) {
        if (!f.expression) continue;
        const r = expressao(f.expression);
        if (r === "texto") return "texto";
        if (r === "icone") icone = true;
      } else if (ts.isJsxSelfClosingElement(f)) {
        const attrs = atributos(f.attributes);
        if (attrs.includes("aria-label") || attrs.includes("title")) return "texto";
        icone = true;
      } else if (ts.isJsxElement(f)) {
        // O `asChild` passa o botão para o filho: o nome pode estar nele.
        const attrsFilho = atributos(f.openingElement.attributes);
        if (attrsFilho.includes("aria-label") || attrsFilho.includes("title")) return "texto";
        const classe = f.openingElement.attributes.properties
          .filter(ts.isJsxAttribute)
          .find((p) => p.name.getText(fonte) === "className")
          ?.initializer?.getText(fonte);
        if (classe && /\bsr-only\b/.test(classe)) return "texto";
        const r = conteudo(f.children);
        if (r === "texto") return "texto";
        if (r === "icone") icone = true;
      } else if (ts.isJsxFragment(f)) {
        const r = conteudo(f.children);
        if (r === "texto") return "texto";
        if (r === "icone") icone = true;
      }
    }
    return icone ? "icone" : "vazio";
  }

  /** Uma expressão dentro do JSX: só ícones (nos dois ramos) ou algo que pode ser texto. */
  function expressao(e: ts.Expression): "texto" | "icone" | "vazio" {
    if (ts.isParenthesizedExpression(e)) return expressao(e.expression);
    if (ts.isJsxSelfClosingElement(e)) return "icone";
    if (ts.isJsxElement(e) || ts.isJsxFragment(e)) {
      const r = conteudo(ts.isJsxElement(e) ? e.children : e.children);
      return r === "vazio" ? "icone" : r;
    }
    if (ts.isConditionalExpression(e)) {
      const a = expressao(e.whenTrue);
      const b = expressao(e.whenFalse);
      if (a === "texto" || b === "texto") return "texto";
      return a === "icone" || b === "icone" ? "icone" : "vazio";
    }
    if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return expressao(e.right);
    }
    if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return "vazio";
    // Texto, número, variável, chamada: pode ser o nome do botão.
    return "texto";
  }

  function visitar(n: ts.Node) {
    if (ts.isJsxElement(n)) {
      const tag = nomeDaTag(n.openingElement.tagName);
      if (tag === "Button" || tag === "button") {
        const attrs = atributos(n.openingElement.attributes);
        const temNome = attrs.some((a) => a === "aria-label" || a === "aria-labelledby" || a === "title");
        if (!temNome && conteudo(n.children) === "icone") {
          const { line } = fonte.getLineAndCharacterOfPosition(n.getStart(fonte));
          achados.push({ linha: line + 1, trecho: n.openingElement.getText(fonte).replace(/\s+/g, " ").slice(0, 120) });
        }
      }
    }
    ts.forEachChild(n, visitar);
  }
  visitar(fonte);
  return achados;
}

/** O spinner de CSS (`animate-spin rounded-full`) sem `role="status"` nele nem no pai. */
export function spinnersMudos(codigo: string, arquivo = "x.tsx"): number[] {
  const fonte = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const linhas: number[] = [];
  const temRole = (a: ts.JsxAttributes) => a.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText(fonte) === "role");
  function visitar(n: ts.Node, paiComRole: boolean) {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) {
      const abertura = ts.isJsxElement(n) ? n.openingElement : n;
      const classe = abertura.attributes.properties
        .filter(ts.isJsxAttribute)
        .find((p) => p.name.getText(fonte) === "className")
        ?.initializer?.getText(fonte);
      const proprio = temRole(abertura.attributes);
      if (classe && /animate-spin/.test(classe) && /rounded-full/.test(classe) && !proprio && !paiComRole) {
        linhas.push(fonte.getLineAndCharacterOfPosition(n.getStart(fonte)).line + 1);
      }
      ts.forEachChild(n, (f) => visitar(f, proprio));
      return;
    }
    ts.forEachChild(n, (f) => visitar(f, paiComRole));
  }
  visitar(fonte, false);
  return linhas;
}

/**
 * A paleta fixa do Tailwind com matiz (o vermelho, o âmbar, o verde...). Os
 * cinzas, o branco e o preto ficam de fora: não fazem as vezes de um token de
 * texto.
 */
const PALETA = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
/** `text-amber-600`, `dark:text-red-400`, `hover:text-emerald-700/80`... */
const COR_FIXA_DE_TEXTO = new RegExp(String.raw`(?<![\w-])(?:[\w\-\[\].]+:)*text-(?:${PALETA})-\d{2,3}(?:\/\d+)?(?![\w-])`, "g");

/**
 * Cor fixa da paleta usada como cor de TEXTO, num arquivo `.tsx`.
 *
 * `text-amber-600` como texto dá 3,2:1 sobre o fundo claro, e
 * `text-red-500`, 3,8:1: a cor fixa não sabe em que tema está nem sobre que
 * fundo. Os tokens `text-primary`, `text-destructive`, `text-success` e
 * `text-warning` leem `--*-texto`, que a regra "o texto tem contraste AA"
 * confere nos dois temas.
 *
 * Fica de fora o que não é texto: a classe de um ícone (o componente do
 * `lucide-react`, o `<svg>` e o ícone passado por variável, `Icone`,
 * `item.icon`), que é decoração ao lado de um texto que já diz o que é. O
 * fundo e a borda (`bg-`, `border-`) nem entram na busca.
 *
 * Usa o compilador do TypeScript: a classe pode estar num mapa de cores fora
 * do JSX (`const COR = { ok: "text-emerald-600" }`), e ali ela vale para o
 * texto em que for usada.
 */
export function coresFixasDeTexto(codigo: string, arquivo = "x.tsx"): { linha: number; classe: string }[] {
  const fonte = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const icones = new Set<string>();
  for (const st of fonte.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== "lucide-react") continue;
    const nomes = st.importClause?.namedBindings;
    if (nomes && ts.isNamedImports(nomes)) for (const e of nomes.elements) icones.add(e.name.text);
  }
  const ehIcone = (tag: string) => icones.has(tag) || tag === "svg" || /(^|\.)ic(on|one)\w*$/i.test(tag) || /Icon$/.test(tag);
  const achados: { linha: number; classe: string }[] = [];
  function visitar(n: ts.Node) {
    if (ts.isJsxAttribute(n) && n.name.getText(fonte) === "className") {
      const elemento = n.parent.parent;
      if ((ts.isJsxSelfClosingElement(elemento) || ts.isJsxOpeningElement(elemento)) && ehIcone(elemento.tagName.getText(fonte))) return;
    }
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      for (const m of n.text.matchAll(COR_FIXA_DE_TEXTO)) {
        achados.push({ linha: fonte.getLineAndCharacterOfPosition(n.getStart(fonte)).line + 1, classe: m[0] });
      }
    }
    ts.forEachChild(n, visitar);
  }
  visitar(fonte);
  return achados;
}

/** "H S% L%" → contraste WCAG entre duas cores do tema. */
function contrasteHsl(a: string, b: string): number {
  const rgb = (hsl: string) => {
    const [h, s, l] = hsl.replace(/%/g, "").trim().split(/\s+/).map(Number);
    const sn = s / 100;
    const ln = l / 100;
    const k = (n: number) => (n + h / 30) % 12;
    const x = sn * Math.min(ln, 1 - ln);
    const f = (n: number) => ln - x * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  };
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => {
      const n = v / 255;
      return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Os tokens `--nome: valor;` do primeiro bloco com aquele seletor em index.css. */
function tokensDoBloco(css: string, seletor: string): Record<string, string> {
  const inicio = css.indexOf(`${seletor} {`);
  const bloco = css.slice(inicio, css.indexOf("}", inicio));
  return Object.fromEntries([...bloco.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/**
 * Cada cor de texto e os fundos sobre os quais ela aparece. O texto sobre o
 * `muted` entra porque as abas, as etiquetas e as listas usam esse fundo.
 */
const PARES_DE_TEXTO: [string, string[]][] = [
  ["foreground", ["background", "card", "muted"]],
  ["muted-foreground", ["background", "card", "muted"]],
  ["primary-texto", ["background", "card", "muted"]],
  ["destructive-texto", ["background", "card", "muted"]],
  ["success-texto", ["background", "card"]],
  ["warning-texto", ["background", "card"]],
  ["primary-foreground", ["primary"]],
  ["accent-foreground", ["accent"]],
  ["destructive-foreground", ["destructive"]],
  ["secondary-foreground", ["secondary"]],
  ["card-foreground", ["card"]],
  ["popover-foreground", ["popover"]],
];

/**
 * Botões só de ícone sem nome que ficam para depois, com o porquê. Vazia desde
 * 06/10/2026; consertou, tire daqui.
 */
const SEM_ROTULO_PENDENTE: Record<string, string> = {};

/**
 * Telas com cor fixa de texto que ficam para depois, com o porquê. A lista só
 * diminui: consertou, tire daqui (o teste cobra), e tela nova não entra.
 */
const COR_FIXA_PENDENTE: Record<string, string> = {
  "components/admin/FaseJornada.tsx": "rodada de 06/10/2026",
  "components/admin/NotasFiscaisPainel.tsx": "rodada de 06/10/2026",
  "components/admin/onboarding/EtapaEquipe.tsx": "rodada de 06/10/2026",
  "components/admin/OrganizacaoBillingGate.tsx": "rodada de 06/10/2026",
  "components/admin/ResponsavelLegalAluno.tsx": "rodada de 06/10/2026",
  "components/admin/SituacaoAluno.tsx": "rodada de 06/10/2026",
  "components/aluno/BaixarMeusDados.tsx": "rodada de 06/10/2026",
  "components/aluno/CalendarioTreinos.tsx": "rodada de 06/10/2026",
  "components/aluno/ControleDieta.tsx": "rodada de 06/10/2026",
  "components/aluno/PontuacaoEngajamento.tsx": "rodada de 06/10/2026",
  "components/app/AlunoSituacaoGate.tsx": "rodada de 06/10/2026",
  "components/AvisoPerfilSimulado.tsx": "rodada de 06/10/2026",
  "components/catraca/ConsentimentoBiometria.tsx": "rodada de 06/10/2026",
  "components/catraca/SaudeGateway.tsx": "rodada de 06/10/2026",
  "components/catraca/TermoImpressoBiometria.tsx": "rodada de 06/10/2026",
  "components/chat/ChatPanel.tsx": "rodada de 06/10/2026",
  "components/encerramento/EncerramentoGate.tsx": "rodada de 06/10/2026",
  "components/ImpersonationBanner.tsx": "rodada de 06/10/2026",
  "components/jornada/CompromissoTab.tsx": "rodada de 06/10/2026",
  "components/jornada/ObjetivosTab.tsx": "rodada de 06/10/2026",
  "components/responsavel/AutorizacaoResponsavel.tsx": "rodada de 06/10/2026",
  "components/sentinela/SentinelaAnamnese.tsx": "rodada de 06/10/2026",
  "components/superadmin/AdocaoMetodologiaCard.tsx": "rodada de 06/10/2026",
  "components/superadmin/CobrancaContaAcademiaOrganizacao.tsx": "rodada de 06/10/2026",
  "components/superadmin/EncerramentoOrganizacao.tsx": "rodada de 06/10/2026",
  "components/superadmin/FilaChamadosMentor.tsx": "rodada de 06/10/2026",
  "components/superadmin/OperacaoGlobalCard.tsx": "rodada de 06/10/2026",
  "components/superadmin/ReceitaHistoricoCard.tsx": "rodada de 06/10/2026",
  "components/superadmin/RepasseOrganizacao.tsx": "rodada de 06/10/2026",
  "pages/admin/AdminCatracas.tsx": "rodada de 06/10/2026",
  "pages/admin/AdminDashboard.tsx": "rodada de 06/10/2026",
  "pages/admin/AdminFinanceiro.tsx": "rodada de 06/10/2026",
  "pages/admin/AdminGestao360.tsx": "rodada de 06/10/2026",
  "pages/admin/AdminImportarAlunos.tsx": "rodada de 06/10/2026",
  "pages/admin/AdminOrganizacao.tsx": "rodada de 06/10/2026",
  "pages/admin/AdminRelatorioSemanal.tsx": "rodada de 06/10/2026",
  "pages/admin/AdminRetencao.tsx": "rodada de 06/10/2026",
  "pages/app/AlunoDashboard.tsx": "rodada de 06/10/2026",
  "pages/app/AlunoDesafios.tsx": "rodada de 06/10/2026",
  "pages/app/AlunoEvolucao.tsx": "rodada de 06/10/2026",
  "pages/app/AlunoTreinos.tsx": "rodada de 06/10/2026",
  "pages/public/DocumentoLegal.tsx": "rodada de 06/10/2026",
  "pages/public/Landing.tsx": "rodada de 06/10/2026",
  "pages/superadmin/SuperAdminDashboard.tsx": "rodada de 06/10/2026",
  "pages/superadmin/SuperAdminEquipamentos.tsx": "rodada de 06/10/2026",
  "pages/superadmin/SuperAdminImplantacao.tsx": "rodada de 06/10/2026",
  "pages/superadmin/SuperAdminUsoIA.tsx": "rodada de 06/10/2026",
  "pages/superadmin/SuperAdminVigia.tsx": "rodada de 06/10/2026",
  "pages/superadmin/SuperAdminWebhooks.tsx": "rodada de 06/10/2026",
};

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.tsx$/.test(nome) && !/\.test\.tsx$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

const telas = arquivos(SRC)
  .map((c) => ({ nome: relative(SRC, c).replace(/\\/g, "/"), codigo: readFileSync(c, "utf8") }))
  .filter((t) => !t.nome.startsWith("components/ui/"));

// Montar a árvore de cada arquivo é a parte cara: só os que têm o que olhar.
const comBotao = telas.filter((t) => /<(Button|button)\b/.test(t.codigo));
const comGiro = telas.filter((t) => /animate-spin/.test(t.codigo));
// Ler e montar a árvore de umas trezentas telas passa dos 5 s numa máquina lenta.
const PRAZO = 60_000;

describe("acessibilidade", () => {
  it("botão só de ícone tem nome", () => {
    expect(botoesSemRotulo('<Button size="icon" onClick={() => abrir()}><Menu className="h-5 w-5" /></Button>'), "o detector detecta").toHaveLength(1);
    expect(botoesSemRotulo('<Button size="icon" aria-label="Abrir menu"><Menu /></Button>')).toHaveLength(0);
    expect(botoesSemRotulo("<button>{aberto ? <Sun /> : <Moon />}</button>"), "ícone dos dois lados").toHaveLength(1);
    expect(botoesSemRotulo('<Button><Plus className="h-4 w-4" /> Novo</Button>')).toHaveLength(0);
    expect(botoesSemRotulo('<Button><Send /><span className="sr-only">Enviar</span></Button>')).toHaveLength(0);
    expect(botoesSemRotulo("<Button>{salvando ? <Loader2 /> : \"Salvar\"}</Button>")).toHaveLength(0);
    expect(botoesSemRotulo('<Button asChild><a href="x" aria-label="E-mail"><Mail /></a></Button>'), "o nome no filho do asChild").toHaveLength(0);
    const violacoes = comBotao
      .flatMap((t) => botoesSemRotulo(t.codigo, t.nome).map((b) => ({ ...b, nome: t.nome })))
      .filter((b) => !SEM_ROTULO_PENDENTE[b.nome])
      .map((b) => `${b.nome}:${b.linha} ${b.trecho}`);
    expect(violacoes, "dê aria-label ao botão só de ícone").toEqual([]);
  }, PRAZO);

  it("toda pendência de rótulo listada ainda existe", () => {
    const consertadas = Object.keys(SEM_ROTULO_PENDENTE).filter((nome) => {
      const tela = telas.find((t) => t.nome === nome);
      return !tela || botoesSemRotulo(tela.codigo, nome).length === 0;
    });
    expect(consertadas, "tire de SEM_ROTULO_PENDENTE").toEqual([]);
  }, PRAZO);

  it("o texto usa o token de cor, e não a cor fixa da paleta", () => {
    expect(coresFixasDeTexto('<p className="text-sm text-amber-600">Atenção</p>'), "o detector detecta").toHaveLength(1);
    expect(coresFixasDeTexto('<p className="text-amber-700 dark:text-amber-400">x</p>'), "e a do tema escuro").toHaveLength(2);
    expect(coresFixasDeTexto('const COR = { ok: "bg-emerald-500/10 text-emerald-700" };'), "no mapa de cores, fora do JSX").toHaveLength(1);
    expect(coresFixasDeTexto("<span className={`font-bold ${ok ? \"text-green-600\" : \"\"}`}>1</span>"), "no texto montado").toHaveLength(1);
    expect(coresFixasDeTexto('import { Check } from "lucide-react";\n<Check className="h-4 w-4 text-emerald-500" />'), "o ícone é decoração").toHaveLength(0);
    expect(coresFixasDeTexto('<Icone className="h-4 w-4 text-amber-500" />'), "o ícone por variável").toHaveLength(0);
    expect(coresFixasDeTexto('<p className="text-warning bg-amber-500/10 border-amber-500/40">x</p>'), "o token e o fundo fixo").toHaveLength(0);
    expect(coresFixasDeTexto('<p className="text-white bg-amber-950">x</p>'), "o neutro não é token de matiz").toHaveLength(0);
    const violacoes = telas
      .filter((t) => !COR_FIXA_PENDENTE[t.nome])
      .flatMap((t) => coresFixasDeTexto(t.codigo, t.nome).map((c) => `${t.nome}:${c.linha} ${c.classe}`));
    expect(
      violacoes,
      "use text-destructive (vermelho), text-warning (âmbar, laranja), text-success (verde) ou text-primary; a cor de categoria fica no fundo e na borda, com o texto em text-foreground",
    ).toEqual([]);
  }, PRAZO);

  it("toda pendência de cor fixa listada ainda existe", () => {
    const consertadas = Object.keys(COR_FIXA_PENDENTE).filter((nome) => {
      const tela = telas.find((t) => t.nome === nome);
      return !tela || coresFixasDeTexto(tela.codigo, nome).length === 0;
    });
    expect(consertadas, "tire de COR_FIXA_PENDENTE").toEqual([]);
  }, PRAZO);

  it("o texto tem contraste AA nos dois temas", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    const claro = tokensDoBloco(css, ":root");
    const escuro = tokensDoBloco(css, ".dark");
    expect(Object.keys(claro).length, "os tokens foram lidos").toBeGreaterThan(20);
    expect(contrasteHsl("43 74% 49%", "40 10% 96%"), "a conta confere com a auditoria (dourado como texto)").toBeCloseTo(2.06, 1);

    const falhas: string[] = [];
    for (const [tema, t] of [["claro", claro], ["escuro", escuro]] as const) {
      for (const [texto, fundos] of PARES_DE_TEXTO) {
        for (const fundo of fundos) {
          const c = contrasteHsl(t[texto], t[fundo]);
          if (!(c >= 4.5)) falhas.push(`${tema}: ${texto} sobre ${fundo} = ${c.toFixed(2)}:1`);
        }
      }
    }
    expect(falhas, "texto pequeno pede 4,5:1 (WCAG AA)").toEqual([]);
  });

  it("text-primary, text-destructive, text-success e text-warning leem o token de texto", () => {
    // Sem isto, o texto voltaria a usar a cor do fundo do botão.
    const config = readFileSync(join(RAIZ, "tailwind.config.ts"), "utf8");
    for (const cor of ["primary", "destructive", "success", "warning"]) {
      const declaracao = new RegExp(`textColor:[\\s\\S]*${cor}:\\s*\\{\\s*DEFAULT:\\s*"hsl\\(var\\(--${cor}-texto\\)\\)"`);
      expect(config, cor).toMatch(declaracao);
    }
  });

  it("a tela pode ser ampliada", () => {
    const html = readFileSync(join(RAIZ, "index.html"), "utf8");
    const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1] ?? "";
    expect(viewport, "a meta viewport existe").toContain("width=device-width");
    expect(viewport, "quem enxerga mal precisa ampliar").not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?(?![\d.])/);
  });

  it('o carregando se anuncia com role="status"', () => {
    expect(spinnersMudos('<div className="h-8 w-8 animate-spin rounded-full border-4" />'), "o detector detecta").toHaveLength(1);
    expect(spinnersMudos('<div role="status" aria-label="Carregando" className="animate-spin rounded-full" />')).toHaveLength(0);
    expect(spinnersMudos('<div role="status"><div className="animate-spin rounded-full" /><p>Saindo...</p></div>')).toHaveLength(0);
    const violacoes = comGiro.flatMap((t) => spinnersMudos(t.codigo, t.nome).map((l) => `${t.nome}:${l}`));
    expect(violacoes, 'use <CarregandoTela /> ou dê role="status" e aria-label').toEqual([]);
  }, PRAZO);
});
