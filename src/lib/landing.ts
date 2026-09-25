/**
 * A página de vendas mora em arkefit.com.br e o app em app.arkefit.com.br
 * (decisão 8 da rodada de lançamento). Os dois saem do mesmo build: o que
 * muda é o que a raiz mostra em cada endereço.
 *
 * A raiz do endereço de vendas só mostra a página de vendas para quem chega
 * de fora: quem tem sessão aberta, ou abre o app instalado na tela de início
 * (que começa em "/"), segue para o app como sempre. Assim ninguém que já usa
 * o ARKE cai numa página de vendas.
 *
 * `VITE_APP_HOST` liga a mudança de endereço: com ele definido, as rotas do
 * app abertas no endereço de vendas vão para o endereço do app, com o mesmo
 * caminho. Sem ele, o app continua respondendo nos dois — é o estado seguro
 * enquanto o DNS de app.arkefit.com.br não existe.
 */

export const HOSTS_DE_VENDAS = ["arkefit.com.br", "www.arkefit.com.br"];

/** Rotas públicas que ficam no endereço de vendas (os documentos legais). */
const ROTAS_DO_SITE = ["/termos", "/privacidade", "/contrato-academia"];

export function ehHostDeVendas(host: string, extras: string[] = []): boolean {
  return [...HOSTS_DE_VENDAS, ...extras].includes(host.toLowerCase());
}

/** A raiz do endereço de vendas mostra a página de vendas? */
export function mostrarPaginaDeVendas({
  host,
  hash,
  temSessao,
  appInstalado,
  forcar = false,
}: {
  host: string;
  hash: string;
  temSessao: boolean;
  appInstalado: boolean;
  forcar?: boolean;
}): boolean {
  const naRaiz = hash === "" || hash === "#" || hash === "#/";
  if (!naRaiz) return false;
  if (forcar) return true;
  return ehHostDeVendas(host) && !temSessao && !appInstalado;
}

/**
 * Para onde mandar quem abriu uma rota do app no endereço de vendas, ou nulo
 * para ficar. O hash vai inteiro: é nele que estão a rota e os tokens dos
 * links de convite e de senha.
 */
export function destinoNoApp(url: { host: string; hash: string; search: string }, appHost: string | undefined): string | null {
  if (!appHost || !ehHostDeVendas(url.host) || url.host.toLowerCase() === appHost.toLowerCase()) return null;
  const rota = url.hash.replace(/^#/, "").split("?")[0];
  if (!rota || rota === "/") return null;
  if (ROTAS_DO_SITE.some((r) => rota === r || rota.startsWith(`${r}/`))) return null;
  return `https://${appHost}/${url.search}${url.hash}`;
}

/** Há sessão do Supabase guardada neste navegador? */
export function haSessaoGuardada(): boolean {
  try {
    for (const armazem of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < armazem.length; i++) {
        const chave = armazem.key(i) ?? "";
        if (chave.startsWith("sb-") && chave.endsWith("-auth-token") && armazem.getItem(chave)) return true;
      }
    }
  } catch {
    // sem storage: tratamos como visitante
  }
  return false;
}

export function appInstaladoNaTela(): boolean {
  try {
    return (
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** Números de mercado da página, cada um com a fonte (item 11 da rodada). */
export const FONTES = {
  panorama: {
    titulo: "Panorama Setorial Fitness Brasil, 5ª edição (2026), dados da ABC EVO",
    url: "https://www.fitnessbrasil.com.br/newsfitbr/tamanho-do-mercado-fitness-brasileiro-os-numeros-que-a-5a-edicao-do-panorama-setorial-revela-sobre-profissionais-centros-e-negocios/",
  },
  sperandei: {
    titulo: "Sperandei, Vieira e Reis (2016), 5.240 alunos de uma academia do Rio de Janeiro, 2005 a 2014",
    url: "https://researchers.westernsydney.edu.au/en/publications/adherence-to-physical-activity-in-an-unsupervised-setting-explana/",
  },
} as const;
