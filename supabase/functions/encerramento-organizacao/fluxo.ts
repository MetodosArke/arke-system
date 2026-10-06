// Textos e regras do encerramento de academia, sem Deno nem Supabase, para o
// teste do app exercitar o código real (src/lib/encerramentoAcademia.test.ts).
// O envio mora no index.ts.

export type AvisoEncerramento = { organizacao_nome: string; iniciativa: string; termino_em: string; eliminacao_em: string };

export type DestinatarioAluno = { user_id: string; email: string | null; nome: string; metodo: boolean };

export type Mensagem = { assunto: string; texto: string; html: string };

/** `2026-10-24` → `24/10/2026`. */
export const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function emHtml(texto: string): string {
  return `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">${texto
    .split("\n")
    .map((l) => (l ? `<p style="margin:0 0 12px">${escapar(l)}</p>` : ""))
    .join("")}</div>`;
}

/** O e-mail do aviso à gestão da academia e à ArkeFit. */
export function emailDeAviso(e: AvisoEncerramento, siteUrl: string): Mensagem {
  const quem = e.iniciativa === "academia" ? "a pedido da academia" : "por decisão da ArkeFit";
  const texto = [
    `O contrato da ${e.organizacao_nome} com o ARKE termina em ${dataBR(e.termino_em)}, ${quem}.`,
    "",
    `Até lá tudo segue funcionando. Em ${dataBR(e.termino_em)}, as cobranças dos alunos pelo ARKE param, as digitais saem das catracas e o painel fica só para exportação.`,
    `Até ${dataBR(e.eliminacao_em)}, a gestão pode exportar todos os dados da academia em Organização → Exportar todos os dados. Depois disso, os dados são eliminados, como prevê o contrato.`,
    "Os alunos recebem um aviso por e-mail e no celular, com o prazo e o que acontece com os dados deles.",
    "",
    `Para retirar o aviso antes do término, ou tirar dúvidas: ${siteUrl}`,
  ].join("\n");
  return { assunto: `ARKE: encerramento do contrato em ${dataBR(e.termino_em)}`, texto, html: emHtml(texto) };
}

/**
 * O e-mail ao aluno: o prazo, o que acaba no término e o que acontece com os
 * dados dele, e onde pedir uma cópia. O aluno do Método ouve também do
 * acompanhamento, porque ali a ArkeFit é a controladora (Política, seção 1).
 */
export function emailAoAluno(
  e: AvisoEncerramento & { etapa: "aviso" | "encerrada" },
  aluno: Pick<DestinatarioAluno, "nome" | "metodo">,
  siteUrl: string,
): Mensagem {
  const academia = e.organizacao_nome;
  const termino = dataBR(e.termino_em);
  const eliminacao = dataBR(e.eliminacao_em);
  const jaTerminou = e.etapa === "encerrada";
  const linhas = [
    `Olá, ${aluno.nome}.`,
    "",
    jaTerminou
      ? `A ${academia} encerrou o uso do ARKE em ${termino}.`
      : `A ${academia} vai encerrar o uso do ARKE em ${termino}. Até lá, tudo segue funcionando no app.`,
    "",
    jaTerminou ? "Desde essa data:" : "Nessa data:",
    "- as cobranças pelo ARKE param: nada novo é cobrado pelo app;",
    "- a sua digital, o seu rosto e o seu cartão são apagados das catracas da academia;",
    "- o app deixa de mostrar os treinos e a rotina desta academia. Treinos e pagamentos passam a ser tratados direto com a recepção.",
  ];
  if (aluno.metodo) {
    linhas.push(
      "",
      `O seu acompanhamento do Método ARKE nesta academia também termina ${jaTerminou ? "aí" : "nessa data"}: a assinatura é cancelada, sem nova cobrança.`,
    );
  }
  linhas.push(
    "",
    `Os seus dados desta academia (cadastro, treinos, dietas, avaliações, frequência e mensagens) ficam guardados até ${eliminacao} e depois são eliminados. Fica só o que a lei manda guardar, como os registros de pagamento. Se esta é a sua única academia no ARKE, a sua conta de acesso também é apagada nessa data.`,
    "",
    `Para pedir uma cópia dos seus dados até ${eliminacao}, fale com a academia${
      aluno.metodo ? "; sobre os dados do Método ARKE, fale com a ArkeFit" : ""
    }. O contato do encarregado de dados da ArkeFit está na Política de Privacidade: ${siteUrl}/#/privacidade`,
    "",
    "Se você também usa o ARKE em outra academia, nada muda lá.",
  );
  const texto = linhas.join("\n");
  const assunto = jaTerminou
    ? `${academia} encerrou o uso do ARKE: o que acontece com os seus dados`
    : `${academia} vai encerrar o uso do ARKE em ${termino}`;
  return { assunto, texto, html: emHtml(texto) };
}

/** O aviso no celular: curto, e o detalhe fica no e-mail. */
export function pushAoAluno(e: AvisoEncerramento & { etapa: "aviso" | "encerrada" }): { title: string; body: string; url: string } {
  return {
    title: e.etapa === "encerrada" ? "Sua academia encerrou o ARKE" : "Sua academia vai encerrar o ARKE",
    body:
      e.etapa === "encerrada"
        ? `Seus dados da ${e.organizacao_nome} ficam até ${dataBR(e.eliminacao_em)}. Mandamos os detalhes por e-mail.`
        : `O app da ${e.organizacao_nome} funciona até ${dataBR(e.termino_em)}. Mandamos por e-mail o que acontece com os seus dados.`,
    url: "/#/app",
  };
}

/**
 * A chave de idempotência do lote no Resend. O lote que não foi confirmado
 * volta igual na rodada seguinte (o banco o devolve pelo mesmo id), e a
 * mesma chave faz o Resend devolver o envio anterior em vez de mandar de novo.
 */
export const chaveDoLote = (encerramentoId: string, lote: string) => `encerramento-alunos/${encerramentoId}/${lote}`;

/** A chave do e-mail à gestão e à ArkeFit: um por aviso de encerramento. */
export const chaveDoAviso = (encerramentoId: string) => `encerramento-aviso/${encerramentoId}`;

/** O corpo do envio em lote ao Resend: um e-mail por aluno com endereço. */
export function loteDeEmails(
  e: AvisoEncerramento & { etapa: "aviso" | "encerrada" },
  destinatarios: DestinatarioAluno[],
  de: string,
  siteUrl: string,
): { from: string; to: string[]; subject: string; html: string; text: string }[] {
  return destinatarios
    .filter((d) => !!d.email)
    .map((d) => {
      const m = emailAoAluno(e, d, siteUrl);
      return { from: de, to: [d.email as string], subject: m.assunto, html: m.html, text: m.texto };
    });
}
