/**
 * A marca da academia no app do aluno (decisão do responsável de 03/10/2026:
 * logo, nome, cor e o app instalado com o nome e o ícone da academia).
 *
 * A cor escolhida pela academia substitui o amarelo da ArkeFit só nos tokens
 * de destaque (`--primary`, `--accent`, o anel de foco, o menu, os gráficos
 * e os degradês). Alerta, erro e sucesso ficam com as cores do sistema: uma
 * academia de marca vermelha não pode transformar todo botão num aviso de
 * erro.
 *
 * A cor nunca fica ilegível. Em cada tema ela precisa de contraste de pelo
 * menos 3:1 com o fundo e com os cartões (o mínimo da WCAG para elemento de
 * interface); quando não tem, o tom é escurecido no tema claro ou clareado no
 * escuro até ter, e a tela da academia mostra que ajustou. O texto sobre a
 * cor é o escuro do sistema ou o branco, o que der mais contraste; num tom
 * médio nenhum dos dois chega a 4,5:1 (o cinza #777 fica em 4,48), e aí o tom
 * anda mais um pouco na mesma direção até o texto do botão passar. Ajustar em
 * vez de recusar: a academia escolhe a cor da marca
 * dela, e recusar uma cor de marca porque não serve num dos temas trocaria a
 * identidade por uma regra que a gente consegue cumprir sozinha.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** "#1a2b3c" ou "#abc", sem diferenciar maiúsculas. Qualquer outra coisa é null. */
export function lerHex(hex: string | null | undefined): Rgb | null {
  const s = String(hex ?? "").trim().toLowerCase();
  const curta = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  const longa = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(s);
  if (curta) return { r: parseInt(curta[1] + curta[1], 16), g: parseInt(curta[2] + curta[2], 16), b: parseInt(curta[3] + curta[3], 16) };
  if (longa) return { r: parseInt(longa[1], 16), g: parseInt(longa[2], 16), b: parseInt(longa[3], 16) };
  return null;
}

/** A forma que o banco guarda: "#rrggbb" em minúsculas. */
export function normalizarHex(hex: string | null | undefined): string | null {
  const c = lerHex(hex);
  return c ? hexDe(c) : null;
}

export function hexDe({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Luminância relativa da WCAG 2.x. */
export function luminancia({ r, g, b }: Rgb): number {
  const canal = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

export function contraste(a: Rgb, b: Rgb): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** A mistura já arredondada: a conta confere o mesmo tom que vira hexadecimal. */
function misturar(a: Rgb, b: Rgb, t: number): Rgb {
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b) };
}

const PRETO: Rgb = { r: 0, g: 0, b: 0 };
const BRANCO: Rgb = { r: 255, g: 255, b: 255 };

/** O texto escuro do sistema (`0 0% 5%`) e o branco. */
const TEXTO_ESCURO: Rgb = { r: 13, g: 13, b: 13 };

function hslParaRgb(h: number, s: number, l: number): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** Os fundos de cada tema, copiados de `src/index.css` (`--background` e `--card`). */
export const FUNDOS = {
  claro: [hslParaRgb(40, 10, 96), BRANCO],
  escuro: [hslParaRgb(0, 0, 6), hslParaRgb(0, 0, 9)],
} as const;

export const CONTRASTE_MINIMO = 3;
/** O texto sobre a cor (o do botão): o mínimo da WCAG para texto normal. */
export const CONTRASTE_TEXTO = 4.5;

function piorContraste(cor: Rgb, fundos: readonly Rgb[]): number {
  return Math.min(...fundos.map((f) => contraste(cor, f)));
}

/**
 * A cor com contraste suficiente sobre os fundos do tema: se já tem, fica
 * como está; se não, vai para o preto (fundo claro) ou para o branco (fundo
 * escuro), aos poucos, até ter.
 */
export function tomParaOTema(cor: Rgb, tema: "claro" | "escuro"): { cor: Rgb; ajustado: boolean } {
  const fundos = FUNDOS[tema];
  const serve = (c: Rgb) => piorContraste(c, fundos) >= CONTRASTE_MINIMO && contraste(c, textoSobre(c)) >= CONTRASTE_TEXTO;
  if (serve(cor)) return { cor, ajustado: false };
  // Para o preto no claro e para o branco no escuro: nessa direção o
  // contraste com o fundo e o do texto do botão sobem juntos.
  const alvo = tema === "claro" ? PRETO : BRANCO;
  for (let t = 0.01; t <= 1; t += 0.01) {
    const tentativa = misturar(cor, alvo, t);
    if (serve(tentativa)) return { cor: tentativa, ajustado: true };
  }
  return { cor: alvo, ajustado: true };
}

/** Preto ou branco sobre a cor: o que der mais contraste. */
export function textoSobre(cor: Rgb): Rgb {
  return contraste(cor, TEXTO_ESCURO) >= contraste(cor, BRANCO) ? TEXTO_ESCURO : BRANCO;
}

/** "H S% L%", o formato dos tokens do tema. */
export function hslDe({ r, g, b }: Rgb): string {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  const um = (n: number) => Math.round(n * 10) / 10;
  return `${um(h)} ${um(s * 100)}% ${um(l * 100)}%`;
}

const css = (rgb: Rgb) => `hsl(${hslDe(rgb).replace(/ /g, ", ")})`;

/**
 * A segunda ponta do degradê: mais clara quando o texto por cima é escuro,
 * mais escura quando é branco, para o texto do botão seguir lendo nas duas
 * pontas.
 */
function pontaDoDegrade(cor: Rgb): Rgb {
  return textoSobre(cor) === BRANCO ? misturar(cor, PRETO, 0.15) : misturar(cor, BRANCO, 0.18);
}

export interface TemaDaMarca {
  /** O tom usado no tema, já com contraste. */
  cor: string;
  /** O tom foi mexido para dar leitura? */
  ajustado: boolean;
  /** Os tokens do tema que a marca substitui. */
  tokens: Record<string, string>;
}

function temaDaMarca(base: Rgb, tema: "claro" | "escuro"): TemaDaMarca {
  const { cor, ajustado } = tomParaOTema(base, tema);
  const texto = textoSobre(cor);
  // O acento é um passo mais fundo no claro e mais aceso no escuro, como o
  // dourado do sistema.
  const acento = misturar(cor, tema === "claro" ? PRETO : BRANCO, 0.12);
  const grafico2 = misturar(cor, tema === "claro" ? PRETO : BRANCO, 0.3);
  return {
    cor: hexDe(cor),
    ajustado,
    tokens: {
      "--primary": hslDe(cor),
      "--primary-foreground": hslDe(texto),
      "--ring": hslDe(cor),
      "--accent": hslDe(acento),
      "--accent-foreground": hslDe(textoSobre(acento)),
      "--sidebar-primary": hslDe(cor),
      "--sidebar-primary-foreground": hslDe(texto),
      "--sidebar-ring": hslDe(cor),
      "--chart-1": hslDe(cor),
      "--chart-2": hslDe(grafico2),
      "--gradient-primary": `linear-gradient(135deg, ${css(cor)}, ${css(pontaDoDegrade(cor))})`,
      "--gradient-accent": `linear-gradient(135deg, ${css(acento)}, ${css(pontaDoDegrade(acento))})`,
    },
  };
}

export interface CoresDaMarca {
  claro: TemaDaMarca;
  escuro: TemaDaMarca;
}

/** Os dois temas a partir da cor da academia. null quando a cor não é válida. */
export function coresDaMarca(hex: string | null | undefined): CoresDaMarca | null {
  const base = lerHex(hex);
  if (!base) return null;
  return { claro: temaDaMarca(base, "claro"), escuro: temaDaMarca(base, "escuro") };
}

/**
 * A folha de estilo que a marca injeta. `html:root` e `html.dark` vencem o
 * `:root` e o `.dark` de `index.css` pela especificidade, qualquer que seja a
 * ordem no documento; o escuro vem depois do claro porque os dois casam no
 * tema escuro.
 */
export function cssDaMarca(cores: CoresDaMarca): string {
  const bloco = (t: TemaDaMarca) =>
    Object.entries(t.tokens)
      .map(([k, v]) => `${k}:${v};`)
      .join("");
  return `html:root{${bloco(cores.claro)}}html.dark{${bloco(cores.escuro)}}`;
}

/** Identidade de academia no endereço: o formato do slug da tela de Organização. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugValido = (s: string) => s.length <= 80 && SLUG_RE.test(s);

/**
 * A academia pela qual a pessoa entrou: o link de entrada, a matrícula e o
 * primeiro acesso (`#/p/<slug>…`) ou o app instalado (`?academia=<slug>`,
 * o endereço de início do manifesto da academia).
 */
export function slugDeEntrada(url: { search: string; hash: string }): string | null {
  const param = new URLSearchParams(url.search).get("academia")?.trim().toLowerCase() ?? "";
  if (slugValido(param)) return param;
  const rota = url.hash.replace(/^#/, "").split("?")[0];
  const m = /^\/p\/([^/]+)/.exec(rota);
  const slug = m ? decodeURIComponent(m[1]).toLowerCase() : "";
  return slugValido(slug) ? slug : null;
}

/** O endereço do manifesto da academia (reescrito pela Vercel para a função `manifest-academia`). */
export function enderecoDoManifesto(slug: string): string {
  return `/manifest/${encodeURIComponent(slug)}`;
}

/** O link que a academia divulga para o aluno entrar (e instalar o app com a marca dela). */
export function linkDeEntrada(origem: string, slug: string): string {
  return `${origem.replace(/\/$/, "")}/#/p/${encodeURIComponent(slug)}/entrar`;
}
