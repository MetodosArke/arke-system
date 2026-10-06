// O e-mail ao responsável legal do aluno menor (decisão de 06/10/2026).
//
// Leva o mínimo: o primeiro nome do aluno, a academia, o nome de cada item a
// autorizar e o link. O texto de cada consentimento fica na página do link,
// e não aqui, para quem decide ler a versão vigente, inteira.
//
// Sem Deno e sem Supabase, para o teste do app exercitar o texto de verdade.
import { ROTULO_PROPOSITO, type PropositoResponsavel } from "../_shared/responsavel.ts";

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? "").trim().split(/\s+/)[0] ?? "";
}

export function emailResponsavel(o: {
  responsavelNome: string;
  alunoPrimeiroNome: string | null;
  academia: string | null;
  propositos: PropositoResponsavel[];
  link: string;
  /** "dd/mm/aaaa", já no fuso de Brasília. */
  validoAte: string;
  pedidoPela: "aluno" | "academia";
}): { assunto: string; html: string; texto: string } {
  const quem = primeiroNome(o.responsavelNome);
  const aluno = o.alunoPrimeiroNome?.trim() || "o aluno";
  const academia = o.academia?.trim() || "a academia";
  const abertura = quem ? `Olá, ${quem}.` : "Olá.";
  const assunto = o.alunoPrimeiroNome?.trim()
    ? `Autorização para ${aluno} na ${academia}`
    : `Autorização de responsável legal na ${academia}`;
  const apresentacao =
    o.pedidoPela === "academia"
      ? `A ${academia} informou você como responsável legal de ${aluno}, que treina lá e usa o ArkeFit, o app da academia.`
      : `${aluno} informou você como responsável legal no ArkeFit, o app da ${academia}.`;
  const itens = o.propositos.map((p) => ROTULO_PROPOSITO[p]);
  const paragrafos = [
    apresentacao,
    `Como ${aluno} tem menos de 18 anos, o uso destes dados depende antes da sua autorização (Lei 13.709/2018, art. 14):`,
  ];
  const depois = [
    "Pelo botão abaixo você lê o texto de cada item e decide o que autoriza: todos, alguns ou nenhum.",
    `O link vale até ${o.validoAte}.`,
    `Se você não é responsável por ${aluno} ou não reconhece este pedido, ignore este e-mail.`,
  ];
  const botao = "Ler e decidir";
  const texto = [abertura, "", ...paragrafos, ...itens.map((i) => `- ${i}`), "", ...depois, "", `${botao}: ${o.link}`].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111;line-height:1.5">
  <p>${escapar(abertura)}</p>
  ${paragrafos.map((p) => `<p>${escapar(p)}</p>`).join("\n  ")}
  <ul>${itens.map((i) => `<li>${escapar(i)}</li>`).join("")}</ul>
  ${depois.map((p) => `<p>${escapar(p)}</p>`).join("\n  ")}
  <p><a href="${escapar(o.link)}" style="display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapar(botao)}</a></p>
</div>`;
  return { assunto, html, texto };
}
