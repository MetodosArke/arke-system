import { defineConfig } from "@playwright/test";

/**
 * Testes de ponta a ponta contra o app publicado.
 *
 * Rodam contra produção por padrão (E2E_BASE_URL troca o alvo): o projeto não
 * tem ambiente de homologação separado, e o que se quer pegar é justamente o
 * que só aparece com o app de verdade no ar — rota que não carrega o próprio
 * arquivo, redirecionamento de rota protegida, página pública que quebra.
 *
 * Usa o Chrome já instalado (channel "chrome") em vez de baixar o do
 * Playwright: na máquina de desenvolvimento e no runner do GitHub ele já
 * existe.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  // 20 s: o caminho real inclui latência de rede até o Supabase, que já foi
  // medida com picos de 6 s entre o preflight e a chamada. Lentidão sistemática
  // ainda estoura; a cauda de um pico isolado, não.
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://www.arkefit.com.br",
    channel: "chrome",
    headless: true,
    locale: "pt-BR",
    trace: "retain-on-failure",
  },
});
