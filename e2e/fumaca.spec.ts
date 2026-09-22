import { test, expect, type Page } from "@playwright/test";

/**
 * Fumaça do app publicado: o que tem que funcionar sem login, depois de todo
 * deploy. Não cria nem altera nada — só lê telas.
 *
 * O que estes testes pegam e os unitários não pegam: página que não consegue
 * baixar o próprio arquivo (code splitting), rota protegida que deixa de
 * redirecionar, e erro que só aparece com o bundle de produção.
 */

/** Falha o teste se a página emitir erro de carregamento de módulo ou cair no ErrorBoundary. */
function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /dynamically imported module|Loading chunk/i.test(m.text())) erros.push(m.text());
  });
  return async () => {
    await expect(page.getByText("Algo deu errado ao carregar o aplicativo")).toHaveCount(0);
    expect(erros, "erros de JavaScript na página").toEqual([]);
  };
}

test("login abre com os campos de acesso", async ({ page }) => {
  const semErros = vigiarErros(page);
  await page.goto("/#/auth/login");
  await expect(page.getByRole("textbox", { name: /e-?mail/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^senha/i })).toBeVisible();
  await semErros();
});

test("cadastro — página carregada sob demanda — renderiza", async ({ page }) => {
  const semErros = vigiarErros(page);
  await page.goto("/#/auth/register");
  await expect(page.getByRole("heading", { name: /criar conta/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^senha/i })).toBeVisible();
  await semErros();
});

test("navegar do login para o cadastro baixa a página nova sem quebrar", async ({ page }) => {
  // O caminho que o code splitting mais arrisca: a navegação dentro do app,
  // que depende de o arquivo da próxima página chegar.
  const semErros = vigiarErros(page);
  await page.goto("/#/auth/login");
  await page.getByRole("button", { name: /cadastre-se/i }).click();
  await expect(page).toHaveURL(/#\/auth\/register/);
  await expect(page.getByRole("heading", { name: /criar conta/i })).toBeVisible();
  await semErros();
});

for (const rota of ["/#/app", "/#/admin", "/#/superadmin"]) {
  test(`rota protegida ${rota} manda para o login sem sessão`, async ({ page }) => {
    await page.goto(rota);
    await expect(page).toHaveURL(/#\/auth\/login/);
  });
}

test("matrícula pública de academia inexistente diz isso, sem quebrar", async ({ page }) => {
  const semErros = vigiarErros(page);
  await page.goto("/#/p/academia-que-nao-existe-e2e");
  await expect(page.getByText(/academia não encontrada/i)).toBeVisible();
  await semErros();
});

// A organização de homologação vive no banco de produção, em trial — é o
// status que passa por `organizacao_liberada()` sem onboarding concluído, e é
// por isso que a página mostra o formulário em vez do aviso de "matrículas em
// breve". Antes da migração para o projeto brasileiro este teste usava a Tietê
// Fitness, que era de testes e não atravessou.
test("matrícula pública da academia de homologação mostra o formulário", async ({ page }) => {
  const semErros = vigiarErros(page);
  await page.goto("/#/p/homologacao");
  await expect(page.getByText(/homologação/i).first()).toBeVisible();
  await expect(page.getByLabel(/senha/i).first()).toBeVisible();
  await semErros();
});
