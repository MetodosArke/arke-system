// O link de uma tela do app num e-mail ou num aviso.
//
// O app mora em `SITE_URL` (docs/INFRAESTRUTURA.md: https://app.arkefit.com.br)
// e usa o HashRouter: a rota vai depois do `#`. Sem ele, o link abre a raiz e
// o React não acha a tela — foi assim que o "Ver o relatório completo" do
// resumo semanal nunca abriu o relatório (06/10/2026). Sem Deno, para o teste
// do app exercitar o código real.

export const APP_PADRAO = "https://app.arkefit.com.br";

/** `linkDoApp(SITE_URL, "/admin/relatorio-semanal")` → `https://app.arkefit.com.br/#/admin/relatorio-semanal`. */
export function linkDoApp(siteUrl: string | null | undefined, rota: string): string {
  const base = (siteUrl?.trim() || APP_PADRAO).replace(/\/+$/, "");
  const semHash = rota.replace(/^\/?#?\/?/, "");
  return `${base}/#/${semHash}`;
}
