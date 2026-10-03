// O e-mail de quem já tinha conta no ArkeFit e passou a ter um painel de
// profissional autônomo. Quem não tinha conta recebe o convite do Auth, que
// cria a senha; quem tinha não recebe convite nenhum (o Auth não convida quem
// existe), e sem este aviso descobriria o painel por acaso.
//
// Sem Deno e sem Supabase, para o teste do app exercitar o texto de verdade.

export type Especialidade = "professor" | "nutricionista";

export const ESPECIALIDADE_ROTULO: Record<Especialidade, string> = {
  professor: "Personal Trainer",
  nutricionista: "Nutricionista",
};

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/**
 * `link` é o de criar a senha quando a pessoa nunca entrou (a conta existe,
 * mas a senha não), e o da tela de entrar quando ela já usa o ArkeFit.
 */
export function emailPainelPronto(opcoes: {
  nome: string;
  painel: string;
  especialidade: Especialidade;
  link: string;
  criarSenha: boolean;
  assinatura?: string;
}): { assunto: string; html: string; texto: string } {
  const { nome, painel, especialidade, link, criarSenha } = opcoes;
  const assinatura = opcoes.assinatura ?? "Equipe ArkeFit";
  const quem = primeiroNome(nome);
  const assunto = `Seu painel de ${ESPECIALIDADE_ROTULO[especialidade]} no ArkeFit está pronto`;
  const abertura = quem ? `Olá, ${quem}.` : "Olá.";
  const paragrafos = [
    `A ArkeFit preparou o painel “${painel}” para você atender os seus alunos: cadastro, prescrição, financeiro e o app com a sua marca.`,
    criarSenha
      ? "O seu e-mail já estava no ArkeFit, mas a senha ainda não foi criada. Crie pelo botão abaixo. Se o link vencer, peça um novo à ArkeFit."
      : "Entre com o mesmo e-mail e a senha que você já usa no ArkeFit. Se tiver mais de um acesso, escolha o painel no alto da tela.",
    "O próprio painel mostra o passo a passo da configuração até o primeiro aluno entrar.",
  ];
  const botao = criarSenha ? "Criar minha senha" : "Entrar no painel";
  const texto = [abertura, "", ...paragrafos, "", `${botao}: ${link}`, "", assinatura].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111;line-height:1.5">
  <p>${escapar(abertura)}</p>
  ${paragrafos.map((p) => `<p>${escapar(p)}</p>`).join("\n  ")}
  <p><a href="${escapar(link)}" style="display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapar(botao)}</a></p>
  <p style="margin-top:24px">${escapar(assinatura)}</p>
</div>`;
  return { assunto, html, texto };
}
