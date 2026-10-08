/**
 * Letícia, o agente comercial: o que o e-mail diz e o que a IA pode dizer.
 * Sem Deno e sem Supabase, para o teste do app exercitar este código, e não
 * uma cópia (`src/lib/agenteComercial.test.ts`).
 *
 * O e-mail é um modelo nosso: o que a ArkeFit faz, o convite e o link da
 * agenda são texto fixo, conferido. A IA escreve só o "espelho", uma ou duas
 * frases sobre o que a academia contou, e ele passa por `espelhoAceito`, que
 * recusa número, valor, plano e promessa. Recusado ou indisponível, o e-mail
 * sai sem ele. Nenhum número chega ao e-mail pela IA.
 */

import { tirarNomes } from "../_shared/assistenteEntrada.ts";

export const CATEGORIAS = ["evasao", "inadimplencia", "catraca", "atendimento", "migracao", "outro"] as const;
export type Categoria = (typeof CATEGORIAS)[number];
export type Etapa = "primeira" | "retorno_1" | "retorno_2";

/** Por onde a academia chegou (`leads_comerciais.origem`). */
export const ORIGENS = ["site", "whatsapp", "telefone", "indicacao", "prospeccao"] as const;
export type Origem = (typeof ORIGENS)[number];

/**
 * A IA só escreve a partir do que a própria academia contou: pelo formulário,
 * no WhatsApp ou por telefone. Na indicação e na prospecção ninguém da
 * academia contou nada, e uma frase de "entendemos o que você passa" seria
 * suposição apresentada como escuta: o e-mail sai só com o texto nosso.
 */
export function usaEspelho(origem: Origem): boolean {
  return origem === "site" || origem === "whatsapp" || origem === "telefone";
}

const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Ordem de prioridade: retenção e inadimplência são o motivo da ArkeFit, e a
// mesma mensagem costuma citar o sistema atual ou a catraca de passagem.
const PALAVRAS: [Categoria, RegExp][] = [
  [
    "evasao",
    /evasao|evadi|cancelam|cancelando|cancela[mr]?\b|desist|retenc|reter|churn|rotatividade|perd\w* (de |os |muitos )?alunos?|(alunos?|gente|pessoas?) (some|somem|sumindo|sumir|param|parando|deixa\w* de vir)|nao volta/,
  ],
  ["inadimplencia", /inadimpl|calote|devedor|cobranc|boleto|pagament|nao paga|mensalidades? (atrasad|em atraso|vencid)/],
  ["catraca", /catraca|biometri|leitor|reconhecimento facial|controle de acesso|control ?id|topdata|henry|dimep/],
  ["migracao", /\bevo\b|tecnofit|next ?fit|\bpacto\b|cloud ?gym|\bw12\b|(trocar|mudar)( de| o)? sistema|migra/],
  ["atendimento", /atendimento|acompanha|engajament|comunica|app (para|pro|dos|de) alunos?|aplicativo/],
];

/** A categoria pelas palavras da mensagem: é o que vale quando a IA não é usada. */
export function categoriaPorPalavras(mensagem: string | null | undefined): Categoria {
  const t = normalizar(mensagem ?? "");
  if (!t.trim()) return "outro";
  for (const [categoria, padrao] of PALAVRAS) if (padrao.test(t)) return categoria;
  return "outro";
}

/** Tira da mensagem os e-mails e os números de telefone antes de ela ir ao modelo. */
export function tirarContatos(mensagem: string): string {
  return mensagem
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[e-mail]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[telefone]");
}

// Linha de despedida, curta, como quem fecha um e-mail: "Att,", "Abraços!",
// "Obrigada". A assinatura vem dela para baixo.
const DESPEDIDA =
  /^(?:(?:att|atte|atenciosamente|cordialmente|abs|abraco|abracos|um abraco|grande abraco|obrigad[oa]|muito obrigad[oa]|grat[oa]|saudacoes|ate mais)\b|--)[\s,.!-]*$/;

/**
 * Tira a assinatura do fim da mensagem: da linha de despedida ("Att,",
 * "Abraços") para baixo, se ela está entre as últimas linhas. É ali que vem o
 * nome de quem escreveu, o cargo e o telefone; o problema da academia vem
 * antes (auditoria de prontidão, 07/10/2026: a mensagem ia ao modelo com a
 * assinatura e o nome).
 */
export function tirarAssinatura(mensagem: string): string {
  const linhas = mensagem.replace(/\r\n/g, "\n").split("\n");
  const ultimas = Math.max(0, linhas.length - 5);
  for (let i = ultimas; i < linhas.length; i++) {
    const linha = normalizar(linhas[i].trim());
    if (linha.length <= 30 && DESPEDIDA.test(linha)) return linhas.slice(0, i).join("\n").trimEnd();
  }
  return mensagem;
}

export const SISTEMA_ESPELHO = `Você ajuda a equipe comercial da ArkeFit, um sistema de gestão e retenção de alunos para academias, a responder quem entrou em contato para conhecer o sistema, pelo site, pelo WhatsApp ou por telefone.

Você recebe o que a academia contou: escrito por ela no formulário do site, ou anotado pela nossa equipe depois de uma conversa. Devolva SOMENTE um JSON, sem nenhum texto antes ou depois, no formato:
{"categoria": "...", "espelho": "..."}

- "categoria": o problema principal que a mensagem conta, uma destas palavras: evasao (alunos cancelando, sumindo, rotatividade), inadimplencia (mensalidade atrasada, cobrança), catraca (controle de acesso, biometria), atendimento (acompanhar alunos, comunicação, aplicativo), migracao (trocar de sistema), outro.
- "espelho": uma ou duas frases curtas, em português do Brasil, falando diretamente com a pessoa ("você", "sua academia"), que repetem com outras palavras o problema que ela contou e mostram que entendemos, com empatia e sem exagero. Exemplo do tom: "Perder alunos nos primeiros meses, sem a recepção perceber a tempo, é das coisas mais frustrantes para quem cuida de uma academia."

Regras do espelho, sem exceção:
- não escreva nenhum número, valor, percentual, quantidade ou prazo;
- não fale de preço, plano, desconto, contrato ou condição comercial;
- não prometa resultado, não diga o que a academia precisa e não fale de solução, ferramenta ou da ArkeFit;
- não cumprimente, não se despeça, não use o nome da pessoa e não faça perguntas;
- se a mensagem não contar um problema da academia (por exemplo, se só pedir preço, proposta ou mais informações), devolva "espelho": "".`;

/**
 * O que vai ao modelo: a mensagem sem contatos, sem a assinatura e sem o nome
 * de quem escreveu (o do cadastro do contato, trocado por "[nome]" onde
 * aparecer), mais a faixa de alunos e o sistema atual. O modelo não precisa
 * saber quem é a pessoa para espelhar o problema da academia.
 */
export function entradaDoModelo(dados: {
  mensagem: string;
  alunos_faixa: string | null;
  sistema_atual: string | null;
  nome?: string | null;
}): string {
  const mensagem = tirarNomes(tirarAssinatura(tirarContatos(dados.mensagem)), dados.nome ? [dados.nome] : []);
  const linhas = [`Mensagem da academia:\n"""\n${mensagem.slice(0, 2000)}\n"""`];
  if (dados.alunos_faixa) linhas.push(`Tamanho da academia: ${ROTULO_FAIXA[dados.alunos_faixa] ?? dados.alunos_faixa}.`);
  if (dados.sistema_atual) linhas.push(`Sistema usado hoje: ${dados.sistema_atual.slice(0, 80)}.`);
  return linhas.join("\n");
}

const ROTULO_FAIXA: Record<string, string> = {
  ate_150: "até 150 alunos",
  "151_500": "de 151 a 500 alunos",
  "501_1000": "de 501 a 1.000 alunos",
  mais_1000: "mais de 1.000 alunos",
};

const PROIBIDO =
  /\b(preco|precos|valor|valores|custo|custos|custa|desconto|descontos|promocao|gratis|gratuito|gratuita|plano|planos|contrato|oferta|investimento|garant\w*|promet\w*|certeza|resolve\w*|solucion\w*|solucao|solucoes|ferramenta\w*|arkefit|podemos|nossa|nossas|nosso|nossos|precisa\w*|aumentar|reduzir|dobrar)\b/;

// Os agentes assinam como equipe, nunca como pessoa (CLAUDE.md): o espelho não
// traz o nome de ninguém da ArkeFit, nem despedida ou assinatura.
const ASSINATURA_DE_PESSOA =
  /\b(leticia|bruno|jean|lucas|atenciosamente|cordialmente|abraco|abracos|att|assinado|assina)\b/;

/**
 * O espelho só entra no e-mail se passar por aqui. `nomes`: o nome de quem
 * escreveu; o espelho não o usa (o "Olá, Maria!" é nosso, e vem antes).
 */
export function espelhoAceito(espelho: string, nomes: string[] = []): boolean {
  const t = espelho.trim();
  if (t.length < 20 || t.length > 350) return false;
  if (/\d/.test(t)) return false;
  if (/r\$|%|https?:|www\.|@|\?|\[nome\]/i.test(t)) return false;
  const n = normalizar(t);
  if (PROIBIDO.test(n) || ASSINATURA_DE_PESSOA.test(n)) return false;
  if (tirarNomes(t, nomes) !== t) return false;
  const frases = t.split(/[.!]+/).filter((f) => f.trim().length > 0);
  return frases.length <= 3;
}

/** Lê a resposta do modelo. Qualquer coisa fora do formato vira nulo. */
/**
 * O modelo escreveu um espelho e a trava (`espelhoAceito`) o recusou. Espelho
 * vazio não é recusa: é o modelo dizendo que não havia o que espelhar. Serve
 * ao medidor de uso das IAs.
 */
export function espelhoRecusado(texto: string, nomes: string[] = []): boolean {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return false;
  try {
    const o = (JSON.parse(texto.slice(inicio, fim + 1)) ?? {}) as Record<string, unknown>;
    const bruto = typeof o.espelho === "string" ? o.espelho.replace(/\s+/g, " ").trim() : "";
    return !!bruto && !espelhoAceito(bruto, nomes);
  } catch {
    return false;
  }
}

export function lerRespostaModelo(texto: string, nomes: string[] = []): { categoria: Categoria | null; espelho: string | null } {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return { categoria: null, espelho: null };
  let obj: unknown;
  try {
    obj = JSON.parse(texto.slice(inicio, fim + 1));
  } catch {
    return { categoria: null, espelho: null };
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  const categoria = (CATEGORIAS as readonly string[]).includes(String(o.categoria)) ? (o.categoria as Categoria) : null;
  const bruto = typeof o.espelho === "string" ? o.espelho.replace(/\s+/g, " ").trim() : "";
  return { categoria, espelho: bruto && espelhoAceito(bruto, nomes) ? bruto : null };
}

// ── O que a ArkeFit faz, por assunto: texto nosso, sem número ─────────────
export const PROPOSTA: Record<Categoria, string> = {
  evasao:
    "O ArkeFit acompanha cada aluno desde a matrícula e avisa a recepção quando alguém começa a sumir, com o que fazer em cada caso, para agir antes de o aluno cancelar.",
  inadimplencia:
    "No ArkeFit a mensalidade é cobrada pelo próprio sistema, com cartão automático, e a situação de cada aluno fica à vista da recepção.",
  catraca:
    "O ArkeFit se liga à catraca da academia, e cada entrada vira a frequência do aluno: é assim que a recepção vê quem está deixando de vir.",
  atendimento:
    "No ArkeFit cada pedido de ajuda do aluno vira uma tarefa com responsável e prazo, e o aluno acompanha o treino e a rotina pelo app da academia.",
  migracao:
    "A base de alunos vem do sistema atual por planilha, e a implantação é acompanhada passo a passo pela nossa equipe.",
  outro: "O ArkeFit junta o app do aluno, o acompanhamento e a cobrança num lugar só, feito para ajudar a academia a reter alunos.",
};

const TEMA: Record<Categoria, string> = {
  evasao: "a evasão dos alunos",
  inadimplencia: "a inadimplência",
  catraca: "a integração com a catraca",
  atendimento: "o acompanhamento dos alunos",
  migracao: "a troca de sistema",
  outro: "o dia a dia da academia",
};

/** "MARIA DA SILVA" → "Maria"; "joão" → "João"; nome já em caixa mista fica como veio. */
export function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  if (!primeiro) return "";
  const misto = primeiro !== primeiro.toUpperCase() && primeiro !== primeiro.toLowerCase();
  return misto ? primeiro : primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

const escapar = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type DadosEmail = {
  etapa: Etapa;
  nome: string;
  academia: string;
  categoria: Categoria;
  espelho: string | null;
  origem: Origem;
  /** Na prospecção, onde o contato foi achado ("Google Maps", "Instagram"). Vai no e-mail. */
  origemDetalhe: string | null;
  agenda: string;
  linkParar: string;
  assinatura: string;
};

const LOGO = "https://arkefit.com.br/logo-email.jpg";
const COR = { texto: "#55575d", titulo: "#0d0d0d", ouro: "#c9952b", apagado: "#999999" };

/** Sem frase da IA, a primeira mensagem abre dizendo por que escrevemos. */
function abertura(origem: Origem, academia: string, fonte: string | null): string {
  switch (origem) {
    case "whatsapp":
      return "Obrigado pelo contato pelo WhatsApp.";
    case "telefone":
      return "Obrigado pela conversa por telefone.";
    case "indicacao":
      return "Sua academia nos foi indicada, e por isso resolvemos escrever.";
    case "prospeccao":
      return `Encontramos o contato de ${academia} numa busca por academias (${fonte ?? "fonte pública"}) e resolvemos escrever.`;
    default:
      return "Obrigado por contar um pouco sobre a sua academia.";
  }
}

/**
 * Por que a pessoa recebeu o e-mail. Quem não pediu o contato (indicação,
 * prospecção) tem de saber de onde a ArkeFit tirou o endereço.
 */
export function motivoDoEmail(origem: Origem, fonte: string | null): string {
  switch (origem) {
    case "whatsapp":
      return "Você recebeu este e-mail porque falou com a ArkeFit pelo WhatsApp.";
    case "telefone":
      return "Você recebeu este e-mail porque falou com a ArkeFit por telefone.";
    case "indicacao":
      return "Você recebeu este e-mail porque a sua academia foi indicada à ArkeFit.";
    case "prospeccao":
      // Entre parênteses, para não depender do artigo ("no Instagram", "no site da academia").
      return `Você recebeu este e-mail porque o contato da sua academia está publicado na internet (${fonte ?? "fonte pública"}).`;
    default:
      return "Você recebeu este e-mail porque pediu contato em arkefit.com.br.";
  }
}

/** Monta o e-mail de cada etapa, em HTML e em texto simples. */
export function montarEmail(d: DadosEmail): { assunto: string; html: string; texto: string } {
  const nome = primeiroNome(d.nome);
  const ola = nome ? `Olá, ${nome}!` : "Olá!";
  const academia = d.academia.trim();
  const tema = TEMA[d.categoria];
  const fonte = d.origemDetalhe?.replace(/\s+/g, " ").trim().slice(0, 80) || null;
  // A frase da IA só vale onde a academia contou algo (`usaEspelho`).
  const espelho = usaEspelho(d.origem) ? d.espelho : null;

  let assunto: string;
  let paragrafos: string[];
  let fecho: string;
  if (d.etapa === "primeira") {
    // Sem artigo antes do nome da academia: "a Studio X" e "o Academia Y"
    // soariam errados, e o nome é o que a pessoa digitou.
    assunto = `${academia} e o ArkeFit`;
    paragrafos = [
      espelho ?? abertura(d.origem, academia, fonte),
      PROPOSTA[d.categoria],
      `O melhor jeito de ver se faz sentido para vocês é uma conversa rápida com o Jean Ramos, um dos fundadores da ArkeFit, com o sistema aberto na tela. Escolha o horário que ficar melhor para você:`,
    ];
    fecho = "Se preferir, é só responder este e-mail.";
  } else if (d.etapa === "retorno_1") {
    assunto = nome ? `Um horário com o Jean, ${nome}?` : "Um horário com o Jean?";
    paragrafos = [
      `Passando para lembrar do convite: uma conversa curta com o Jean, com o sistema aberto na tela, ajuda a ver como o ArkeFit trata ${tema} no dia a dia de vocês.`,
    ];
    fecho = "Se o momento não for bom, é só responder dizendo quando fica melhor.";
  } else {
    assunto = "Último lembrete sobre a demonstração do ArkeFit";
    paragrafos = [
      `Este é o nosso último lembrete. Se um dia fizer sentido conversar sobre ${tema}, a agenda do Jean continua aberta:`,
    ];
    fecho = "E, se preferir, é só responder este e-mail quando quiser.";
  }

  const rodape = `${motivoDoEmail(d.origem, fonte)} Não quer mais receber?`;

  const texto = [
    ola,
    "",
    ...paragrafos.flatMap((p) => [p, ""]),
    `Escolher um horário: ${d.agenda}`,
    "",
    fecho,
    "",
    d.assinatura,
    "ArkeFit · arkefit.com.br",
    "",
    "—",
    `${rodape} ${d.linkParar}`,
  ].join("\n");

  const p = (t: string) => `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:${COR.texto}">${escapar(t)}</p>`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:560px;margin:0 auto;padding:28px 24px;font-family:Arial,Helvetica,sans-serif">
<img src="${LOGO}" width="48" height="48" alt="ArkeFit" style="display:block;border:0;margin:0 0 24px">
<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:${COR.titulo};font-weight:bold">${escapar(ola)}</p>
${paragrafos.map(p).join("\n")}
<p style="margin:0 0 22px"><a href="${escapar(d.agenda)}" style="display:inline-block;background:${COR.ouro};color:${COR.titulo};font-weight:bold;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:8px">Escolher um horário</a></p>
${p(fecho)}
<p style="margin:0 0 4px;font-size:15px;color:${COR.titulo}">${escapar(d.assinatura)}</p>
<p style="margin:0;font-size:13px;color:${COR.apagado}">ArkeFit · arkefit.com.br</p>
<p style="margin:32px 0 0;font-size:12px;line-height:1.5;color:${COR.apagado}">${escapar(rodape)} <a href="${escapar(d.linkParar)}" style="color:${COR.apagado}">Clique aqui</a>.</p>
</div></body></html>`;

  return { assunto, html, texto };
}
