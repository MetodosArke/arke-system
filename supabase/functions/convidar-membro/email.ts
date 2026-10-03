// O aviso a quem já tinha conta no ArkeFit e foi matriculado em mais uma
// academia. Quem não tinha conta recebe o convite do Auth para criar a senha;
// quem tinha não recebe convite nenhum (o Auth não convida quem existe), e sem
// este aviso descobriria a academia nova por acaso.
//
// Sem Deno e sem Supabase, para o teste do app exercitar o texto de verdade.

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/**
 * `link` é o de criar a senha quando a pessoa nunca entrou, e o da tela de
 * entrar da academia quando ela já usa o ArkeFit.
 */
export function emailMatriculaNova(o: { nome: string; academia: string; link: string; criarSenha: boolean }): {
  assunto: string;
  html: string;
  texto: string;
} {
  const quem = primeiroNome(o.nome);
  const abertura = quem ? `Olá, ${quem}.` : "Olá.";
  const assunto = `Sua matrícula na ${o.academia} está no app`;
  const paragrafos = [
    `A ${o.academia} fez a sua matrícula no ArkeFit, o app que ela usa para treinos, agenda e acompanhamento.`,
    o.criarSenha
      ? "O seu e-mail já estava no ArkeFit, mas a senha ainda não foi criada. Crie pelo botão abaixo."
      : "Entre com o mesmo e-mail e a senha que você já usa no ArkeFit. Se você estiver em mais de uma academia, escolha qual no alto da tela.",
    "Se você não reconhece esta matrícula, fale com a recepção da academia.",
  ];
  const botao = o.criarSenha ? "Criar minha senha" : "Entrar no app";
  const texto = [abertura, "", ...paragrafos, "", `${botao}: ${o.link}`].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111;line-height:1.5">
  <p>${escapar(abertura)}</p>
  ${paragrafos.map((p) => `<p>${escapar(p)}</p>`).join("\n  ")}
  <p><a href="${escapar(o.link)}" style="display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapar(botao)}</a></p>
</div>`;
  return { assunto, html, texto };
}
