// O convite para a equipe da ArkeFit e a retirada do acesso, sem Deno nem
// Supabase, para o teste do app exercitar o código real
// (src/lib/acessosArkefit.test.ts e equipeArkefit.guarda.test.ts).
//
// Até 08/10/2026 as contas da ArkeFit nasciam direto no banco. O convite
// segue o molde da equipe da academia (cadastrar-membro-equipe): e-mail sem
// conta recebe o convite do Auth, sem senha, e a senha nasce no link do
// e-mail, que é a prova de posse. A diferença: e-mail que já tem conta é
// recusado. Ligar o papel de sócio a uma conta que existe abriria o
// pré-sequestro de conta (quem se cadastrou antes com o e-mail de outra pessoa
// e tem a senha dela ganharia a Visão Master), e a ArkeFit não tem o vínculo
// pendente da gestão para esperar a prova.

/** Os papéis da ArkeFit (`app_role`): o mesmo que `PapelArkefit` em src/lib/acessosArkefit.ts. */
export type PapelArkefit = "superadmin" | "admin_arke";

export type AcessoArkefit = { id: string; nome: string; papeis: readonly PapelArkefit[] };

/**
 * Espelho de `ACESSOS_ARKEFIT` (src/lib/acessosArkefit.ts), sem a descrição,
 * que é só da tela. Nível novo entra nos dois; `acessosArkefit.test.ts` falha
 * se um mudar sem o outro.
 */
export const ACESSOS_ARKEFIT: readonly AcessoArkefit[] = [
  { id: "socio", nome: "Sócio", papeis: ["superadmin", "admin_arke"] },
];

export function acessoPorId(id: unknown): AcessoArkefit | null {
  if (typeof id !== "string") return null;
  return ACESSOS_ARKEFIT.find((a) => a.id === id) ?? null;
}

/** O nome do nível que tem exatamente estes papéis; os papéis, se nenhum tiver. */
export function nomeDoAcesso(papeis: readonly string[]): string {
  const chave = (lista: readonly string[]) => [...new Set(lista)].sort().join(",");
  return ACESSOS_ARKEFIT.find((a) => chave(a.papeis) === chave(papeis))?.nome ?? papeis.join(", ");
}

export const JA_TEM_CONTA =
  "Esse e-mail já tem conta no ArkeFit. Para a equipe da ArkeFit, use um e-mail que ainda não tenha conta.";
export const SO_SOCIO = "Só um sócio da ArkeFit, com a verificação em duas etapas, convida e tira o acesso da equipe.";
export const JA_CRIOU_A_SENHA =
  "Essa pessoa já criou a senha. Se ela esqueceu, é só usar “Esqueceu a senha?” na tela de entrar.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Pedido =
  | { acao: "convidar"; nome: string; email: string; acesso: AcessoArkefit }
  | { acao: "reenviar"; userId: string }
  | { acao: "retirar"; userId: string };

export type Leitura = { ok: true; pedido: Pedido } | { ok: false; erro: string };

/** O corpo do pedido, conferido. Sem `acao`, é um convite (a tela manda sempre). */
export function lerPedido(corpo: unknown): Leitura {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { ok: false, erro: "Pedido inválido." };
  const c = corpo as Record<string, unknown>;
  const acao = c.acao ?? "convidar";

  if (acao === "reenviar" || acao === "retirar") {
    const userId = typeof c.user_id === "string" ? c.user_id.trim().toLowerCase() : "";
    if (!UUID_RE.test(userId)) return { ok: false, erro: "Pessoa inválida." };
    return { ok: true, pedido: { acao, userId } };
  }
  if (acao !== "convidar") return { ok: false, erro: "Ação inválida." };

  const nome = typeof c.nome === "string" ? c.nome.trim().replace(/\s+/g, " ") : "";
  if (nome.length < 2 || nome.length > 120) return { ok: false, erro: "Informe o nome de quem vai entrar (até 120 letras)." };
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, erro: "E-mail inválido." };
  const acesso = acessoPorId(c.acesso);
  if (!acesso) return { ok: false, erro: "Escolha o acesso." };
  return { ok: true, pedido: { acao, nome, email, acesso } };
}

/** A data e a hora de Brasília, como o aviso da troca de carteira escreve. */
export function quandoEmBrasilia(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(agora);
}

type Email = { assunto: string; texto: string; html: string };

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** O nome numa linha só, para o assunto e o corpo: o nome vem do perfil, que a pessoa escreve. */
const umaLinha = (s: string, padrao: string) => s.replace(/\s+/g, " ").trim().slice(0, 120) || padrao;

/** Os parágrafos e, no fim, o botão do link (no texto puro, o link escrito). */
function montar(assunto: string, linhas: string[], link: { rotulo: string; url: string }): Email {
  const texto = [...linhas, `${link.rotulo}: ${link.url}`].join("\n\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5;color:#111">${linhas
    .map((l) => `<p style="margin:0 0 12px">${escapar(l)}</p>`)
    .join("")}<p><a href="${escapar(link.url)}" style="display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapar(link.rotulo)}</a></p></div>`;
  return { assunto, texto, html };
}

/**
 * O aviso aos outros sócios (o remetente de alertas, como o da troca da
 * carteira de recebimento): quem convidou ou tirou, o nome de quem entrou ou
 * saiu, o acesso e a data. Sem e-mail de ninguém no texto: o nome basta para
 * reconhecer, e o resto está na auditoria.
 */
export function avisoAosSocios(a: {
  evento: "convidada" | "acesso_retirado";
  ator: string;
  pessoa: string;
  acesso: string;
  quando: string;
  painel: string;
}): Email {
  const ator = umaLinha(a.ator, "Um sócio");
  const pessoa = umaLinha(a.pessoa, "uma pessoa");
  if (a.evento === "convidada") {
    return montar(`ArkeFit: ${pessoa} foi convidado(a) para a equipe`, [
      `${ator} convidou ${pessoa} para a equipe da ArkeFit, com o acesso ${a.acesso}, em ${a.quando}.`,
      "A pessoa recebe um e-mail para criar a senha. Depois, a Visão Master pede a verificação em duas etapas; sem ela, a conta não tem nenhum acesso da ArkeFit.",
      "Se você não reconhece este convite, tire o acesso em Visão Master → Equipe ArkeFit e fale com quem convidou por outro canal. O registro está na Auditoria.",
    ], { rotulo: "Abrir a Equipe ArkeFit", url: a.painel });
  }
  return montar(`ArkeFit: ${pessoa} saiu da equipe`, [
    `${ator} tirou o acesso de ${pessoa} (${a.acesso}) à ArkeFit, em ${a.quando}.`,
    "As sessões abertas da pessoa foram encerradas. A conta continua existindo, sem nenhum acesso da ArkeFit.",
    "Se você não reconhece esta retirada, fale com quem tirou por outro canal. O registro está na Auditoria da Visão Master.",
  ], { rotulo: "Abrir a Equipe ArkeFit", url: a.painel });
}

/**
 * O convite de novo, para quem ainda não criou a senha. O link é o de definir
 * a senha (`generateLink` de recuperação), que serve também a quem nunca
 * abriu o primeiro e-mail: abrir o link confirma o e-mail.
 */
export function emailDeNovoConvite(a: { nome: string; ator: string; link: string }): Email {
  const nome = umaLinha(a.nome, "");
  const ator = umaLinha(a.ator, "Um sócio da ArkeFit");
  return montar("Seu convite para a equipe da ArkeFit", [
    nome ? `Olá, ${nome}.` : "Olá.",
    `${ator} convidou você para a equipe da ArkeFit. Para entrar, crie a sua senha pelo botão abaixo.`,
    "Depois da senha, o app pede a verificação em duas etapas: um código do aplicativo autenticador do seu celular (Google Authenticator, Microsoft Authenticator ou similar). Tenha ele à mão.",
    "Se você não esperava este convite, ignore este e-mail: sem o link, ninguém entra na conta.",
  ], { rotulo: "Criar minha senha", url: a.link });
}
