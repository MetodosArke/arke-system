// O assistente da academia: a parte que não fala com rede nem com banco.
// Sem Deno e sem Supabase, para o teste do app exercitar o código real.

import type { Publico, Trecho } from "./indice.ts";

// A limpeza do que vai ao modelo mora em `_shared`, junto da porta dele.
export { montarEntrada, tirarContatos, tirarNomes } from "../_shared/assistenteEntrada.ts";

// ── Busca ──────────────────────────────────────────────────────────────────

const STOP = new Set(
  (
    "a o as os um uma uns umas de do da dos das no na nos nas em por para pra com sem sobre entre ate apos ao aos " +
    "e ou mas que se nao sim ja mais menos muito pouco como quando onde qual quais quem porque porque pois entao " +
    "eu voce voces ele ela eles elas nos meu minha meus minhas seu sua seus suas dele dela isso isto esse essa este esta " +
    "aquele aquela ser estar ter tem tinha foi era sao esta estao fica ficar faz fazer feito pode posso consigo conseguir " +
    "preciso precisa quero queria gostaria vou vai ainda tambem so ate hoje agora aqui ali la ha oi ola bom boa dia tarde noite " +
    "obrigado obrigada favor duvida ajuda arke arkefit sistema tudo bem todo toda todos todas coisa algo alguem nada"
  ).split(/\s+/)
);

export function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Raiz grosseira, de propósito: as cinco primeiras letras das palavras de seis
 * ou mais, e também as quatro primeiras das de cinco ou mais. "Cadastro",
 * "cadastrar" e "cadastrei" caem juntos; "catraca" e "catracas" também; e o
 * verbo conjugado acha o substantivo ("pauso" e "pausado", pela raiz "paus").
 * A raiz de quatro entrou depois da avaliação de 05/10/2026, em que "como
 * pauso ele" não achava o artigo da situação do aluno; num conjunto de 28
 * perguntas, a busca foi de 26 para 27, sem perder nenhuma. Para os artigos
 * da Central, é o bastante; a busca do banco com dicionário só entra se esta
 * não der conta.
 */
export function raizes(t: string): string[] {
  return normalizar(t)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !STOP.has(p))
    .flatMap((p) => (p.length >= 6 ? [p.slice(0, 5), p.slice(0, 4)] : p.length === 5 ? [p, p.slice(0, 4)] : [p]));
}

export type Achado = { slug: string; artigo: string; secao: string | null; texto: string; pontos: number };

/** Os trechos que respondem, só dos artigos que quem pergunta pode ler, no máximo dois por artigo. */
export function buscarTrechos(indice: Trecho[], pergunta: string, publicos: Publico[], quantos = 4): Achado[] {
  const consulta = [...new Set(raizes(pergunta))];
  if (!consulta.length) return [];
  const visiveis = indice.filter((t) => t.publicos.some((p) => publicos.includes(p)));
  const docs = visiveis.map((t) => {
    const contagem = new Map<string, number>();
    for (const r of raizes(t.texto)) contagem.set(r, (contagem.get(r) ?? 0) + 1);
    return { t, contagem, titulo: new Set(raizes(`${t.artigo} ${t.secao ?? ""}`)) };
  });
  const df = new Map<string, number>();
  for (const q of consulta) df.set(q, docs.filter((d) => d.contagem.has(q) || d.titulo.has(q)).length);
  const n = docs.length || 1;
  const pontuados = docs
    .map((d) => {
      let pontos = 0;
      for (const q of consulta) {
        const tf = d.contagem.get(q) ?? 0;
        const noTitulo = d.titulo.has(q);
        if (!tf && !noTitulo) continue;
        const idf = Math.log(1 + n / (df.get(q) || 1));
        pontos += idf * (tf / (tf + 1.2) + (noTitulo ? 1.5 : 0));
      }
      return { d, pontos };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.d.t.slug.localeCompare(b.d.t.slug));
  const porArtigo = new Map<string, number>();
  const achados: Achado[] = [];
  for (const { d, pontos } of pontuados) {
    const ja = porArtigo.get(d.t.slug) ?? 0;
    if (ja >= 2) continue;
    porArtigo.set(d.t.slug, ja + 1);
    achados.push({ slug: d.t.slug, artigo: d.t.artigo, secao: d.t.secao, texto: d.t.texto, pontos: Math.round(pontos * 100) / 100 });
    if (achados.length >= quantos) break;
  }
  return achados;
}

// ── De que a pergunta trata ────────────────────────────────────────────────

export type Intencao = "catraca" | "acesso" | "cobranca" | "configuracao";

const SINAIS: Record<Intencao, string[]> = {
  catraca: ["catra", "gatew", "digit", "biome", "rosto", "facia", "leito", "giro", "borbo", "torni", "entra", "carta", "barra", "liber"],
  acesso: ["senha", "acess", "login", "convi", "ativa", "app", "aplic", "entra", "link", "email", "logar"],
  cobranca: ["cobra", "bolet", "pix", "fatur", "pagam", "pagar", "pago", "paga", "mensa", "inadi", "venci", "carta", "valor", "debit"],
  configuracao: ["confi", "impla", "etapa", "asaas", "receb", "conta", "nota", "fisca", "contr", "plano", "planos", "carte", "onboa", "cnpj", "cpf"],
};

export function detectarIntencoes(pergunta: string): Intencao[] {
  const r = new Set(raizes(pergunta));
  return (Object.keys(SINAIS) as Intencao[]).filter((i) => SINAIS[i].some((s) => r.has(s)));
}

/** Os artigos que cada papel lê: o espelho de `publicosDaArea` no app. */
export function publicosDoPapel(papel: string, autonomo: boolean, especialidade: string | null): Publico[] {
  if (autonomo) return ["autonomo", especialidade === "nutricionista" ? "nutricionista" : "professor"];
  switch (papel) {
    case "gestor":
      return ["gestor"];
    case "recepcao":
      return ["recepcao"];
    case "professor":
      return ["professor"];
    case "nutricionista":
      return ["nutricionista"];
    default:
      return [];
  }
}

// ── A situação na hora, em texto, sem nome de ninguém ──────────────────────

type CatracaCtx = { nome: string; situacao: string; ultima_sincronizacao: string | null; fila_offline: number };
type AlunoCtx = {
  situacao: string;
  entra_no_app: boolean;
  primeiro_acesso_em: string | null;
  tem_numero_catraca: boolean;
  no_metodo: boolean;
  cobranca: { descricao: string; vencimento: string; status: string } | null;
};
export type Contexto = {
  papel: string;
  catracas?: CatracaCtx[];
  alunos?: AlunoCtx[];
  implantacao?: { liberado: boolean; proxima: { etapa: string; detalhe: string } | null } | null;
};

const SITUACAO_CATRACA: Record<string, string> = {
  online: "no ar",
  contingencia: "em contingência (internet falhando, decidindo pelo cadastro guardado)",
  offline: "sem sinal (computador do Gateway desligado, sem internet ou com o programa parado)",
  nunca_conectou: "nunca conectou (Gateway não instalado ou não configurado)",
  desativada: "desativada no ARKE",
};
const SITUACAO_ALUNO: Record<string, string> = { em_dia: "em dia", pausado: "pausado", inadimplente: "inadimplente" };

function haQuanto(iso: string | null, agora: Date): string {
  if (!iso) return "nunca";
  const min = Math.max(0, Math.round((agora.getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

/**
 * O que o modelo pode saber da situação, sem nome, e-mail, CPF ou id: o
 * aluno é "o aluno citado". O texto vai ao modelo (fora do Brasil, desde
 * 03/10/2026) e serve só para ele não contradizer o que a tela mostra.
 */
export function resumoSituacao(ctx: Contexto, agora: Date): string {
  const linhas: string[] = [];
  for (const c of ctx.catracas ?? []) {
    linhas.push(
      `Catraca "${c.nome}": ${SITUACAO_CATRACA[c.situacao] ?? c.situacao}; última sincronização ${haQuanto(c.ultima_sincronizacao, agora)}` +
        (c.fila_offline ? `; ${c.fila_offline} acessos guardados para subir.` : ".")
    );
  }
  const alunos = ctx.alunos ?? [];
  if (alunos.length > 1) linhas.push(`Há ${alunos.length} alunos com esse nome; a pessoa precisa conferir qual é.`);
  if (alunos.length === 1) {
    const a = alunos[0];
    linhas.push(
      `O aluno citado está ${SITUACAO_ALUNO[a.situacao] ?? a.situacao}; ${a.entra_no_app ? "entra no app e passa na catraca" : "não entra no app nem passa na catraca"}; ` +
        `${a.primeiro_acesso_em ? "já entrou no app" : "nunca entrou no app"}; ` +
        `${a.tem_numero_catraca ? "tem número na catraca" : "não tem número na catraca"}` +
        (a.no_metodo ? "; está no Método ARKE" : "") +
        (a.cobranca ? `; tem cobrança em aberto (${a.cobranca.status === "atrasado" ? "atrasada" : "pendente"}).` : ".")
    );
  }
  if (ctx.alunos && alunos.length === 0) linhas.push("Nenhum aluno com esse nome nesta academia.");
  if (ctx.implantacao) {
    linhas.push(
      ctx.implantacao.liberado
        ? "A configuração da academia está concluída."
        : `A configuração ainda não terminou${ctx.implantacao.proxima ? `: falta ${ctx.implantacao.proxima.detalhe}` : ""}.`
    );
  }
  return linhas.join("\n");
}

// ── A IA ───────────────────────────────────────────────────────────────────

export const SISTEMA_ASSISTENTE = `Você é o assistente do painel do ArkeFit, o sistema de gestão e retenção de alunos que academias e personal trainers usam. Quem pergunta é alguém da equipe da academia (gestão, recepção, professor ou nutricionista).

Você recebe a pergunta, trechos da Central de Ajuda do ArkeFit e, às vezes, a situação do sistema na hora. Responda em português do Brasil, falando com a pessoa ("você"), em no máximo 3 frases curtas e práticas, dizendo o que fazer e em que tela. Responda só o que foi perguntado.

Regras, sem exceção:
- Use só o que está nos trechos e na situação. Não invente telas, botões, prazos, números nem regras.
- Quando os trechos descrevem casos parecidos (por exemplo, estados diferentes de um equipamento, ou situações diferentes de um aluno), use só o caso que corresponde à pergunta e à situação, com o nome exato que o trecho usa. Não junte o que um caso diz com o outro.
- Se não tiver certeza, não afirme: diga onde a pessoa confere.
- Se os trechos não respondem, diga apenas que não encontrou isso na Central de Ajuda e que dá para chamar a ArkeFit pelo botão abaixo.
- A situação do sistema vale mais que a sua suposição: não contradiga o que ela diz.
- Não dê orientação de treino, dieta, saúde, jurídica ou contábil. Não fale de preço.
- Não use markdown, listas, títulos nem links. Só texto corrido.`;

/**
 * A resposta da IA só vai para a tela se for texto corrido, sem link e sem
 * número que não esteja nos trechos, na situação ou na pergunta: é a regra
 * "nenhuma IA escreve número" do resto do sistema. Recusada, a tela mostra os
 * artigos e os cartões, que já respondem sozinhos.
 */
export function diagnosticoAceito(texto: string, fontes: string): string | null {
  const limpo = texto
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (limpo.length < 20 || limpo.length > 900) return null;
  if (/https?:\/\/|www\./i.test(limpo)) return null;
  const numerosFonte = new Set((normalizar(fontes).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")));
  const numeros = (limpo.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
  if (numeros.some((n) => !numerosFonte.has(n))) return null;
  return limpo;
}

// ── O chamado para a ArkeFit ───────────────────────────────────────────────

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const PAPEL_ROTULO: Record<string, string> = {
  gestor: "gestão",
  recepcao: "recepção",
  professor: "professor",
  nutricionista: "nutricionista",
};

export function montarEmailChamado(o: {
  organizacao: string;
  autonomo: boolean;
  nome: string;
  email: string;
  papel: string;
  pergunta: string;
  resposta: string | null;
  artigos: string[];
  /** A situação do sistema quando o chamado foi aberto, sem nome de pessoa. */
  situacao?: string | null;
  prazo: string;
  site: string;
}): { assunto: string; html: string; texto: string } {
  const resumo = o.pergunta.replace(/\s+/g, " ").trim();
  const assunto = `Dúvida de ${o.organizacao}: ${resumo.length > 60 ? `${resumo.slice(0, 57)}...` : resumo}`;
  const quem = `${o.nome || o.email} (${PAPEL_ROTULO[o.papel] ?? o.papel}${o.autonomo ? ", profissional autônomo" : ""}), ${o.email}`;
  const link = `${o.site}/#/superadmin/suporte`;
  const linhas = [
    `${quem} abriu um chamado pelo assistente do painel. Responda pelo e-mail dele (é para ele que vai a resposta deste e-mail) e registre o desfecho em Visão Master → Suporte.`,
    "",
    "Pergunta:",
    o.pergunta,
    "",
    o.resposta ? `O assistente respondeu:\n${o.resposta}\n` : "O assistente não escreveu resposta (a IA está desligada ou não achou).\n",
    o.artigos.length ? `Artigos sugeridos: ${o.artigos.join(", ")}` : "Nenhum artigo da Central de Ajuda bateu com a pergunta.",
    ...(o.situacao ? ["", "Situação no sistema quando o chamado foi aberto:", o.situacao, ""] : []),
    `Prazo para responder: ${o.prazo}.`,
    "",
    `Abrir a fila: ${link}`,
  ];
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111;line-height:1.5">
  <p>${escapar(quem)} abriu um chamado pelo assistente do painel. Responda pelo e-mail dele (é para ele que vai a resposta deste e-mail) e registre o desfecho em Visão Master → Suporte.</p>
  <p style="margin-bottom:4px"><strong>Pergunta</strong></p>
  <p style="margin-top:4px;white-space:pre-wrap">${escapar(o.pergunta)}</p>
  ${o.resposta ? `<p style="margin-bottom:4px"><strong>O assistente respondeu</strong></p><p style="margin-top:4px;color:#444">${escapar(o.resposta)}</p>` : `<p style="color:#444">O assistente não escreveu resposta (a IA está desligada ou não achou).</p>`}
  <p>${o.artigos.length ? `Artigos sugeridos: ${escapar(o.artigos.join(", "))}` : "Nenhum artigo da Central de Ajuda bateu com a pergunta."}</p>
  ${o.situacao ? `<p style="margin-bottom:4px"><strong>Situação no sistema quando o chamado foi aberto</strong></p><p style="margin-top:4px;white-space:pre-wrap;color:#444">${escapar(o.situacao)}</p>` : ""}
  <p>Prazo para responder: ${escapar(o.prazo)}.</p>
  <p><a href="${escapar(link)}" style="display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">Abrir a fila de suporte</a></p>
</div>`;
  return { assunto, html, texto: linhas.join("\n") };
}
