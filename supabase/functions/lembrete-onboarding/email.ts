// Texto do lembrete de onboarding parado. Separado do index.ts, sem Deno nem
// Supabase, para o teste (src/lib/lembreteOnboarding.test.ts) importá-lo direto.

const ROTULO_ETAPA: Record<string, string> = {
  dados: "Dados da academia",
  recebimentos: "Conta de recebimentos (Asaas)",
  planos: "Planos e preços",
  equipe: "Equipe",
  alunos: "Alunos",
};

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function montarLembrete(
  nome: string,
  pendentes: string | null,
  link: string
): { assunto: string; html: string; texto: string } {
  const etapas = (pendentes ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => ROTULO_ETAPA[e] ?? e);
  const assunto = `${nome}: faltam ${etapas.length || "poucas"} etapa(s) para liberar o app aos seus alunos`;
  const texto = [
    `Olá! A configuração da ${nome} no ARKE ainda não foi concluída.`,
    "",
    "Enquanto isso, o painel funciona normalmente, mas os alunos ainda não entram no app e as cobranças não começam.",
    "",
    etapas.length ? "Falta:" : "",
    ...etapas.map((e) => `- ${e}`),
    "",
    `Continue de onde parou: ${link}`,
    "",
    "Equipe ArkeFit",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
  <p>Olá! A configuração da <strong>${escapar(nome)}</strong> no ARKE ainda não foi concluída.</p>
  <p>Enquanto isso, o painel funciona normalmente, mas os alunos ainda não entram no app e as cobranças não começam.</p>
  ${etapas.length ? `<p>Falta:</p><ul>${etapas.map((e) => `<li>${escapar(e)}</li>`).join("")}</ul>` : ""}
  <p><a href="${escapar(link)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Continuar de onde parei</a></p>
  <p style="color:#666;font-size:12px">Equipe ArkeFit</p>
</div>`;
  return { assunto, html, texto };
}
