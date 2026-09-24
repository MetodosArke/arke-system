/**
 * O termo de autorização do uso da digital — um texto só, para o app e para o
 * papel.
 *
 * O aluno autoriza de dois jeitos: no app (Perfil → Privacidade) ou assinando
 * o termo impresso na recepção, quando não usa o app. Os dois precisam dizer
 * exatamente a mesma coisa, na mesma versão: autorização dada por um texto
 * diferente do que o banco registra como vigente não prova o que foi
 * autorizado. Por isso o texto mora aqui, e não em cada tela.
 *
 * `VERSAO_CONSENTIMENTO_BIOMETRIA` é o espelho de
 * `public.versao_consentimento_biometrico()`. Mudou o texto, muda a versão lá
 * e aqui — `versaoBiometria.guarda.test.ts` confere.
 */
export const VERSAO_CONSENTIMENTO_BIOMETRIA = "2026-09-23";

export const TITULO_TERMO_BIOMETRIA = "Autorização para uso da impressão digital na catraca";

/** Os parágrafos do termo, na ordem. O app mostra; o papel imprime. */
export const TEXTO_TERMO_BIOMETRIA = [
  "Autorizo o uso da minha impressão digital para o controle de acesso e frequência na academia.",
  "A digital fica guardada somente nas catracas da academia. O ARKE guarda apenas o número com que a catraca me identifica, nunca a digital.",
  "A digital é apagada das catracas quando eu retirar esta autorização — pelo app ou pedindo na recepção — ou quando deixar a academia.",
  "O registro desta autorização é mantido pelo prazo legal, como prova de que ela foi dada.",
];

const escapar = (texto: string) =>
  texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const formatarCpf = (cpf: string | null | undefined) => {
  const d = (cpf ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : "____________________";
};

/**
 * O termo pronto para imprimir: a academia, o aluno com CPF, o texto, a
 * versão e o espaço de assinatura. Página HTML simples, sem nada externo —
 * a janela de impressão abre direto nela.
 */
export function htmlTermoBiometria(dados: { academia: string; aluno: string; cpf?: string | null; data?: Date }): string {
  const data = (dados.data ?? new Date()).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapar(TITULO_TERMO_BIOMETRIA)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; max-width: 680px; margin: 32px auto; padding: 0 24px; line-height: 1.55; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #444; margin-bottom: 24px; }
  p { font-size: 14px; }
  .dados { margin: 20px 0; font-size: 14px; }
  .assinatura { margin-top: 56px; border-top: 1px solid #111; width: 70%; padding-top: 6px; font-size: 13px; }
  .rodape { margin-top: 40px; font-size: 11px; color: #555; }
  @media print { body { margin: 0 auto; } }
</style>
</head>
<body>
  <h1>${escapar(TITULO_TERMO_BIOMETRIA)}</h1>
  <div class="meta">${escapar(dados.academia)} · versão do termo ${VERSAO_CONSENTIMENTO_BIOMETRIA}</div>
  <div class="dados">
    <div><strong>Aluno(a):</strong> ${escapar(dados.aluno)}</div>
    <div><strong>CPF:</strong> ${formatarCpf(dados.cpf)}</div>
  </div>
  ${TEXTO_TERMO_BIOMETRIA.map((p) => `<p>${escapar(p)}</p>`).join("\n  ")}
  <p>Esta autorização é específica para este fim (Lei 13.709/2018, art. 11, I) e pode ser retirada a qualquer momento.</p>
  <div class="dados"><strong>Local e data:</strong> ______________________, ${escapar(data)}</div>
  <div class="assinatura">Assinatura do(a) aluno(a)</div>
  <div class="rodape">Depois de assinado, este termo é anexado ao cadastro do aluno no ARKE e guardado como prova da autorização.
  A política de privacidade da plataforma está em arkefit.com.br/#/privacidade.</div>
</body>
</html>`;
}

/**
 * Abre o termo numa janela e chama a impressão. Chamado no clique do botão,
 * para o navegador não tratar a janela como pop-up indesejado.
 */
export function imprimirTermoBiometria(dados: { academia: string; aluno: string; cpf?: string | null }): boolean {
  const janela = window.open("", "_blank", "width=800,height=900");
  if (!janela) return false;
  janela.document.open();
  janela.document.write(htmlTermoBiometria(dados));
  janela.document.close();
  janela.focus();
  // Um instante para o navegador montar a página antes do diálogo.
  setTimeout(() => janela.print(), 250);
  return true;
}
