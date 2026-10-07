// O e-mail a quem já tinha conta no ArkeFit e foi chamado para a equipe de uma
// academia (ou para a parceria de um profissional autônomo). O vínculo nasce
// pendente e só vale quando a pessoa define a senha pelo link: é a prova de
// que o e-mail é dela (auditoria de 06/10/2026). Quem não tinha conta recebe o
// convite do próprio Auth.
//
// Sem Deno e sem Supabase, para o teste do app exercitar o texto de verdade.

export const PAPEL_ROTULO: Record<string, string> = {
  professor: "personal (professor)",
  nutricionista: "nutricionista",
  recepcao: "recepção",
};

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

export function emailEquipePendente(o: { nome: string; academia: string; papel: string; link: string }): {
  assunto: string;
  html: string;
  texto: string;
} {
  const quem = primeiroNome(o.nome);
  const abertura = quem ? `Olá, ${quem}.` : "Olá.";
  const assunto = `Confirme o seu acesso à equipe de ${o.academia}`;
  const paragrafos = [
    `${o.academia} incluiu você na equipe no ArkeFit, como ${PAPEL_ROTULO[o.papel] ?? o.papel}.`,
    "O seu e-mail já tinha conta no ArkeFit. O acesso à equipe só vale depois que você definir a sua senha pelo botão abaixo: é o que confirma que este e-mail é seu. A senha nova vale para a conta toda, e as outras sessões abertas dela são encerradas.",
    "Se você não reconhece este convite, ignore este e-mail: sem o link, nada muda na sua conta.",
  ];
  const botao = "Definir minha senha";
  const texto = [abertura, "", ...paragrafos, "", `${botao}: ${o.link}`].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111;line-height:1.5">
  <p>${escapar(abertura)}</p>
  ${paragrafos.map((p) => `<p>${escapar(p)}</p>`).join("\n  ")}
  <p><a href="${escapar(o.link)}" style="display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapar(botao)}</a></p>
</div>`;
  return { assunto, html, texto };
}
