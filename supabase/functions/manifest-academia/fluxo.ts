/**
 * O manifesto do app instalado com a marca da academia (decisão do
 * responsável de 03/10/2026). Puro, sem Deno nem Supabase, para os testes do
 * app conferirem o mesmo código que roda.
 *
 * Cada academia vira um app à parte na tela do celular: `id` e `start_url`
 * levam `?academia=<slug>`, e o app abre já na tela de entrar da academia.
 * Os caminhos começam em "/" e resolvem no endereço do app, porque a Vercel
 * serve este manifesto no próprio domínio (`/manifest/<slug>`).
 */

export interface MarcaManifesto {
  nome: string;
  slug: string;
  icone_192: string | null;
  icone_512: string | null;
}

const ICONES_ARKEFIT = [
  { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

const BASE = {
  scope: "/",
  display: "standalone",
  background_color: "#0F0F0F",
  theme_color: "#0F0F0F",
  orientation: "portrait-primary",
};

/** O manifesto padrão, igual a `public/manifest.json`: academia que não existe volta a ser ArkeFit. */
export const MANIFESTO_ARKEFIT = {
  ...BASE,
  id: "/",
  name: "ArkeFit",
  short_name: "ArkeFit",
  description: "Sistema inteligente de gestão de treinos e evolução de alunos",
  start_url: "/",
  icons: ICONES_ARKEFIT,
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Palavras que abrem o nome de quase toda academia e não a distinguem. */
const GENERICAS = new Set(["academia", "studio", "estudio", "espaco", "centro", "ct", "box", "clube", "club"]);
const LIGACOES = new Set(["de", "do", "da", "dos", "das"]);

/**
 * O nome embaixo do ícone. O Android corta o que passa de uns 12 a 15
 * caracteres, então "Academia Horizonte" vira "Horizonte", que é o que
 * distingue; nome curto fica inteiro.
 */
export function nomeCurto(nome: string, limite = 15): string {
  const n = nome.trim().replace(/\s+/g, " ");
  if (n.length <= limite) return n;
  const palavras = n.split(" ");
  while (palavras.length > 1 && GENERICAS.has(semAcento(palavras[0].toLowerCase()))) palavras.shift();
  while (palavras.length > 1 && LIGACOES.has(palavras[0].toLowerCase())) palavras.shift();
  let curto = "";
  for (const p of palavras) {
    const c = curto ? `${curto} ${p}` : p;
    if (c.length > limite) break;
    curto = c;
  }
  return curto || palavras[0].slice(0, limite);
}

const https = (u: string | null) => (u && /^https:\/\//.test(u) ? u : null);

export function montarManifesto(marca: MarcaManifesto | null): Record<string, unknown> {
  if (!marca) return MANIFESTO_ARKEFIT;
  const inicio = `/?academia=${encodeURIComponent(marca.slug)}`;
  const i192 = https(marca.icone_192);
  const i512 = https(marca.icone_512);
  return {
    ...BASE,
    id: inicio,
    name: marca.nome,
    short_name: nomeCurto(marca.nome),
    description: `App da ${marca.nome}, com tecnologia ArkeFit`,
    start_url: inicio,
    // Sem ícone gerado, o app sai com o nome da academia e o ícone da ArkeFit.
    icons:
      i192 && i512
        ? [
            { src: i192, sizes: "192x192", type: "image/png", purpose: "any" },
            { src: i512, sizes: "512x512", type: "image/png", purpose: "any" },
            { src: i512, sizes: "512x512", type: "image/png", purpose: "maskable" },
          ]
        : ICONES_ARKEFIT,
  };
}

/** O slug do caminho (`/manifest-academia/<slug>`) ou do parâmetro `slug`. */
export function slugDoPedido(url: URL): string | null {
  const doCaminho = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const candidato = (url.searchParams.get("slug") ?? (doCaminho === "manifest-academia" ? "" : doCaminho)).trim().toLowerCase();
  let s = candidato;
  try {
    s = decodeURIComponent(candidato);
  } catch {
    return null;
  }
  return s.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) ? s : null;
}
