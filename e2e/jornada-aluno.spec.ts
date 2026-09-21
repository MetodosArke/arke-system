import { test, expect } from "@playwright/test";

/**
 * Jornada autenticada do aluno — a que paga a conta.
 *
 * Só roda com E2E_EMAIL e E2E_SENHA definidos: precisa de uma conta de aluno
 * de teste permanente, e como o projeto não tem homologação separada, essa
 * conta mora em produção (na academia de homologação). Criar a conta e pôr as
 * credenciais nos secrets do GitHub é decisão da ArkeFit; sem elas estes
 * testes aparecem como "skipped", não como aprovados.
 *
 * Só lê telas: nada aqui registra treino, responde check-in ou altera dado,
 * para a conta de teste não virar ruído nas métricas da academia.
 */

const email = process.env.E2E_EMAIL;
const senha = process.env.E2E_SENHA;

test.describe("jornada do aluno", () => {
  test.skip(!email || !senha, "Defina E2E_EMAIL e E2E_SENHA (conta de aluno de teste) para rodar.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/#/auth/login");
    await page.getByRole("textbox", { name: /e-?mail/i }).fill(email!);
    await page.getByRole("textbox", { name: /^senha/i }).fill(senha!);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page).toHaveURL(/#\/app/);
  });

  test("home abre com a próxima ação no topo", async ({ page }) => {
    // Diretriz da home: um único bloco de topo decidido por definirProximaAcao.
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(page.getByText("Algo deu errado ao carregar o aplicativo")).toHaveCount(0);
  });

  test("treinos e perfil abrem", async ({ page }) => {
    await page.goto("/#/app/treinos");
    await expect(page.getByText("Algo deu errado ao carregar o aplicativo")).toHaveCount(0);
    await page.goto("/#/app/perfil");
    await expect(page.getByRole("button", { name: /sair/i })).toBeVisible();
  });
});
