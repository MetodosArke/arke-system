import { test, expect, type Page } from "@playwright/test";

/**
 * O painel do gestor, depois de todo deploy: a gestora de testes entra e
 * percorre as telas principais. Só lê: não cadastra, não cobra, não publica.
 *
 * A conta mora em produção, na academia "ARKE Homologação — testes
 * automáticos" (slug `homologacao`, em trial), ao lado do aluno de
 * `jornada-aluno.spec.ts`. As duas contas têm a mesma senha, que vai para o
 * secret E2E_SENHA por `scripts/migracao/conta-e2e.mjs`; o e-mail da gestora
 * é fixo aqui, porque o workflow só passa E2E_EMAIL e E2E_SENHA. Sem o secret,
 * o teste aparece como "skipped".
 */

const email = process.env.E2E_GESTOR_EMAIL ?? "e2e-gestor@arkefit.com.br";
const senha = process.env.E2E_SENHA;

/** As telas e um texto que prova que cada uma carregou o conteúdo. */
const TELAS: [string, RegExp][] = [
  ["/#/admin", /fila|atendimento|implanta/i],
  ["/#/admin/alunos", /alunos/i],
  ["/#/admin/mensagens", /mensagens/i],
  ["/#/admin/financeiro", /financeiro/i],
  ["/#/admin/catracas", /catraca/i],
  ["/#/admin/comunicados", /comunicados/i],
  ["/#/admin/retencao", /reten/i],
  ["/#/admin/gestao-360", /gest[aã]o/i],
  ["/#/admin/organizacao", /organiza/i],
  ["/#/admin/ajuda", /ajuda/i],
];

function vigiar(page: Page) {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(`erro de JavaScript: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && /dynamically imported module|Loading chunk/i.test(m.text())) erros.push(m.text());
    // A CSP ainda só observa: o que ela acusar nas telas logadas fica anotado
    // no resultado do teste, sem reprovar.
    if (/Report Only|Content Security Policy/i.test(m.text())) {
      test.info().annotations.push({ type: "csp", description: m.text().slice(0, 300) });
    }
  });
  // 5xx do Supabase é falha nossa; 4xx pode ser regra de acesso funcionando.
  page.on("response", (r) => {
    if (r.url().includes(".supabase.co/") && r.status() >= 500) erros.push(`${r.status()} em ${new URL(r.url()).pathname}`);
  });
  return erros;
}

test.describe("painel do gestor", () => {
  test.skip(!senha, "Defina E2E_SENHA (contas de teste) para rodar.");

  test("a gestora entra e as telas principais abrem", async ({ page }) => {
    test.setTimeout(180_000);
    const erros = vigiar(page);

    await page.goto("/#/auth/login");
    await page.getByRole("textbox", { name: /e-?mail/i }).fill(email);
    await page.getByRole("textbox", { name: /^senha/i }).fill(senha!);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page).toHaveURL(/#\/admin/);

    // Aceite dos documentos: na primeira entrada e a cada versão nova.
    // O aceite substitui o painel inteiro; sem ele, o painel abre no <main>.
    // Espera a rede assentar: a consulta do aceite pode voltar depois de o
    // painel aparecer.
    await page.waitForLoadState("networkidle");
    const aceite = page.getByText("Antes de continuar");
    await expect(aceite.or(page.getByRole("main"))).toBeVisible();
    if (await aceite.isVisible()) {
      for (const caixa of await page.getByRole("checkbox").all()) await caixa.check();
      await page.getByRole("button", { name: /aceitar e continuar/i }).click();
      await expect(aceite).toHaveCount(0);
    }

    for (const [rota, texto] of TELAS) {
      await test.step(rota, async () => {
        await page.goto(rota);
        await expect(page.getByRole("main").getByText(texto).first(), `o conteúdo de ${rota}`).toBeVisible();
        await expect(page.getByText("Algo deu errado ao carregar o aplicativo")).toHaveCount(0);
      });
    }
    expect(erros, "erros durante o percurso").toEqual([]);
  });
});
