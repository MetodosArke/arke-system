import { test, expect } from "@playwright/test";

/**
 * Jornada autenticada do aluno — a que paga a conta.
 *
 * Só roda com E2E_EMAIL e E2E_SENHA definidos: precisa de uma conta de aluno
 * de teste permanente, e como o projeto não tem homologação separada, essa
 * conta mora em produção — e2e-jornada@arkefit.com.br, na organização
 * "ARKE Homologação" (slug `homologacao`), no plano Free e com situação
 * `em_dia`. Free não passa pelo acolhimento M.A.P.A.®, então o app abre
 * direto na home, que é o que este teste confere.
 *
 * A conta é criada e a senha vai para os secrets do GitHub por
 * `scripts/migracao/conta-e2e.mjs` — a senha não é impressa em lugar nenhum,
 * porque quem a usa é o workflow. Sem os secrets, estes testes aparecem como
 * "skipped", não como aprovados.
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

    // Aceite dos documentos legais: aparece na primeira entrada e a cada nova
    // versão dos termos. É a única escrita que este teste faz — uma vez por
    // versão, na conta de teste —, e é o que um aluno de verdade faria.
    const aceite = page.getByText("Antes de continuar");
    await expect(aceite.or(page.getByRole("heading", { name: /próxima ação/i }))).toBeVisible();
    if (await aceite.isVisible()) {
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: /aceitar e continuar/i }).click();
      await expect(aceite).toHaveCount(0);
    }
  });

  test("home abre com a próxima ação no topo", async ({ page }) => {
    // Diretriz da home: um único bloco de topo decidido por definirProximaAcao.
    // Conferir o bloco pelo nome, não "algum título": o acolhimento M.A.P.A.®
    // também tem título, e foi assim que uma conta sem acolhimento concluído
    // passava aqui sem nunca ter visto a home.
    await expect(page.getByRole("heading", { name: /próxima ação/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /progresso semanal/i })).toBeVisible();
    await expect(page.getByText("Algo deu errado ao carregar o aplicativo")).toHaveCount(0);
  });

  test("treinos e perfil abrem", async ({ page }) => {
    await page.goto("/#/app/treinos");
    await expect(page.getByText("Algo deu errado ao carregar o aplicativo")).toHaveCount(0);
    await page.goto("/#/app/perfil");
    // O "Sair" do próprio perfil, no conteúdo da página — a barra lateral e o
    // cabeçalho têm outro, e sem o escopo o seletor fica ambíguo.
    await expect(page.getByRole("main").getByRole("button", { name: /sair/i })).toBeVisible();
  });
});
