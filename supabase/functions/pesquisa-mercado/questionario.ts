/**
 * A pesquisa de mercado com donos e gestores de academia (15/10/2026).
 *
 * Um módulo só, sem Deno e sem Supabase, que a tela pública (`/pesquisa`), a
 * edge function `pesquisa-mercado` e a Visão Master → Pesquisa de mercado leem:
 * as perguntas, a validação de cada resposta contra a lista fechada, o resumo
 * dos resultados e as linhas do CSV. É pesquisa neutra: nenhuma pergunta cita
 * concorrente nem vende o ArkeFit.
 *
 * Mudou pergunta ou opção, sobe a `VERSAO_QUESTIONARIO`: cada resposta guarda a
 * versão com que foi dada, e a função recusa a versão que não é a de agora.
 */

export const VERSAO_QUESTIONARIO = 1;

export type Opcao = { id: string; rotulo: string };

type Base = { id: string; numero: number; titulo: string };

export type Pergunta =
  | (Base & {
      tipo: "unica";
      opcoes: readonly Opcao[];
      /** A opção que abre um texto opcional (gravado em `<id>_qual`). */
      comTexto?: { opcao: string; rotulo: string };
      /** Só aparece, e só vale, com esta resposta noutra pergunta. */
      se?: { pergunta: string; opcao: string };
    })
  | (Base & { tipo: "varias"; opcoes: readonly Opcao[]; max: number })
  | (Base & { tipo: "escala" })
  | (Base & { tipo: "texto"; max: number });

/** Os recursos (8 a 25) são respondidos todos com esta escala. */
export const ESCALA: readonly Opcao[] = [
  { id: "essencial", rotulo: "Uso e é essencial" },
  { id: "vivo_sem", rotulo: "Uso, mas vivo sem" },
  { id: "interesse", rotulo: "Não uso, mas teria interesse" },
  { id: "nao_faz_falta", rotulo: "Não uso e não faz falta" },
  { id: "nao_sei", rotulo: "Não sei o que é" },
];

/** O tamanho do texto de "qual" (perguntas 5 e 26). */
const QUAL_MAX = 120;

const recurso = (numero: number, id: string, titulo: string): Pergunta => ({ id, numero, titulo, tipo: "escala" });

export const BLOCOS: readonly { titulo: string; ajuda?: string; perguntas: readonly Pergunta[] }[] = [
  {
    titulo: "Sobre você",
    perguntas: [
      {
        id: "papel",
        numero: 1,
        titulo: "Seu papel",
        tipo: "unica",
        opcoes: [
          { id: "dono_socio", rotulo: "Dono ou sócio" },
          { id: "gestor", rotulo: "Gestor" },
          { id: "coordenador_tecnico", rotulo: "Coordenador técnico" },
          { id: "recepcao", rotulo: "Recepção" },
          { id: "outro", rotulo: "Outro" },
        ],
      },
      {
        id: "tipo_negocio",
        numero: 2,
        titulo: "Tipo do negócio",
        tipo: "unica",
        opcoes: [
          { id: "musculacao", rotulo: "Musculação" },
          { id: "funcional_box", rotulo: "Funcional ou box" },
          { id: "estudio", rotulo: "Estúdio (pilates, yoga)" },
          { id: "lutas", rotulo: "Lutas" },
          { id: "natacao", rotulo: "Natação" },
          { id: "varias_modalidades", rotulo: "Várias modalidades" },
          { id: "personal_autonomo", rotulo: "Personal autônomo" },
        ],
      },
      {
        id: "alunos",
        numero: 3,
        titulo: "Alunos ativos",
        tipo: "unica",
        opcoes: [
          { id: "ate_100", rotulo: "Até 100" },
          { id: "101_300", rotulo: "101 a 300" },
          { id: "301_500", rotulo: "301 a 500" },
          { id: "501_1000", rotulo: "501 a 1.000" },
          { id: "mais_1000", rotulo: "Mais de 1.000" },
        ],
      },
      {
        id: "unidades",
        numero: 4,
        titulo: "Unidades",
        tipo: "unica",
        opcoes: [
          { id: "1", rotulo: "1" },
          { id: "2_3", rotulo: "2 a 3" },
          { id: "4_mais", rotulo: "4 ou mais" },
        ],
      },
      {
        id: "usa_sistema",
        numero: 5,
        titulo: "Usa um sistema de gestão hoje?",
        tipo: "unica",
        opcoes: [
          { id: "sim", rotulo: "Sim" },
          { id: "nao", rotulo: "Não, uso planilha ou caderno" },
        ],
        comTexto: { opcao: "sim", rotulo: "Qual? (opcional)" },
      },
      {
        id: "quanto_paga",
        numero: 6,
        titulo: "Quanto paga por mês pelo sistema",
        tipo: "unica",
        opcoes: [
          { id: "ate_200", rotulo: "Até R$ 200" },
          { id: "201_400", rotulo: "R$ 201 a 400" },
          { id: "401_700", rotulo: "R$ 401 a 700" },
          { id: "701_1000", rotulo: "R$ 701 a 1.000" },
          { id: "mais_1000", rotulo: "Mais de R$ 1.000" },
          { id: "nao_sei", rotulo: "Não sei" },
        ],
        se: { pergunta: "usa_sistema", opcao: "sim" },
      },
    ],
  },
  {
    titulo: "O que mais pesa",
    perguntas: [
      {
        id: "tira_o_sono",
        numero: 7,
        titulo: "O que mais tira o seu sono hoje?",
        tipo: "varias",
        max: 3,
        opcoes: [
          { id: "evasao", rotulo: "Aluno que some e cancela" },
          { id: "inadimplencia", rotulo: "Inadimplência" },
          { id: "captar", rotulo: "Captar aluno novo" },
          { id: "equipe", rotulo: "Equipe e atendimento" },
          { id: "financeiro", rotulo: "Controle financeiro (caixa, contas a pagar)" },
          { id: "catraca", rotulo: "Catraca e acesso" },
          { id: "tarefa_manual", rotulo: "Tempo gasto com tarefa manual" },
          { id: "outro", rotulo: "Outro" },
        ],
      },
    ],
  },
  {
    titulo: "Os recursos",
    ajuda: "Para cada recurso, diga como ele está na sua academia hoje.",
    perguntas: [
      recurso(8, "cobranca_automatica", "Cobrança automática da mensalidade (cartão, Pix, boleto), com bloqueio do inadimplente"),
      recurso(9, "nova_tentativa", "Nova tentativa automática de cobrança atrasada (cartão de novo, link por mensagem)"),
      recurso(10, "nota_fiscal", "Nota fiscal automática"),
      recurso(11, "caixa_comissao", "Caixa, contas a pagar e comissão de professores"),
      recurso(12, "loja", "Venda de produtos (loja, lanchonete), com estoque e comanda"),
      recurso(13, "funil_vendas", "Funil de vendas para interessados e aula experimental"),
      recurso(14, "mensagens_automaticas", "Mensagens automáticas (aniversário, \"sumido\", cobrança) por WhatsApp, SMS ou e-mail"),
      recurso(15, "atendente_ia", "Atendente virtual com IA no WhatsApp"),
      recurso(16, "satisfacao", "Pesquisa de satisfação dos alunos"),
      recurso(17, "clube_pontos", "Clube de pontos e recompensas"),
      recurso(18, "app_treino", "App do aluno com treino"),
      recurso(19, "avaliacao_fisica", "Avaliação física e acompanhamento da evolução"),
      recurso(20, "dieta_app", "Dieta e plano alimentar no app"),
      recurso(21, "agenda_aulas", "Agenda de aulas e reserva de vaga"),
      recurso(22, "agregadores", "Wellhub, TotalPass ou ClassPass integrados"),
      recurso(23, "catraca_biometria", "Catraca com digital ou reconhecimento facial"),
      recurso(24, "relatorios", "Relatórios e indicadores (evasão, frequência, receita)"),
      recurso(25, "aviso_sumido", "Aviso de quem está sumindo, com tarefa para a equipe agir"),
    ],
  },
  {
    titulo: "Valor",
    perguntas: [
      {
        id: "paga_sem_usar",
        numero: 26,
        titulo: "Você paga hoje por algum recurso que quase não usa?",
        tipo: "unica",
        opcoes: [
          { id: "sim", rotulo: "Sim" },
          { id: "nao", rotulo: "Não" },
          { id: "nao_sei", rotulo: "Não sei" },
        ],
        comTexto: { opcao: "sim", rotulo: "Qual? (opcional)" },
      },
      {
        id: "trocaria_por_essencial",
        numero: 27,
        titulo: "Um sistema só com o essencial, por um preço bem menor: trocaria?",
        tipo: "unica",
        opcoes: [
          { id: "sim", rotulo: "Sim" },
          { id: "talvez", rotulo: "Talvez" },
          { id: "nao", rotulo: "Não" },
        ],
      },
      {
        id: "pesa_na_escolha",
        numero: 28,
        titulo: "O que mais pesa na escolha de um sistema?",
        tipo: "varias",
        max: 2,
        opcoes: [
          { id: "preco", rotulo: "Preço" },
          { id: "facilidade", rotulo: "Facilidade de usar" },
          { id: "recursos", rotulo: "Recursos" },
          { id: "suporte", rotulo: "Suporte" },
          { id: "app_aluno", rotulo: "App do aluno" },
          { id: "indicacao", rotulo: "Indicação" },
        ],
      },
      { id: "recurso_para_trocar", numero: 29, titulo: "Que recurso faria você trocar de sistema amanhã?", tipo: "texto", max: 500 },
    ],
  },
];

export const PERGUNTAS: readonly Pergunta[] = BLOCOS.flatMap((b) => b.perguntas);

export type Respostas = Record<string, string | string[]>;

/** As perguntas que a pessoa precisa responder: as fechadas que estão à vista. */
export function obrigatoria(p: Pergunta, respostas: Respostas): boolean {
  return p.tipo !== "texto" && visivel(p, respostas);
}

export function visivel(p: Pergunta, respostas: Respostas): boolean {
  return p.tipo !== "unica" || !p.se || respostas[p.se.pergunta] === p.se.opcao;
}

export const chaveDoTexto = (id: string) => `${id}_qual`;

const textoLimpo = (v: string, max: number) => v.replace(/[ \t]+/g, " ").trim().slice(0, max);

type Falha = { ok: false; pergunta: string | null; erro: string };

/**
 * Confere as respostas contra a lista fechada e devolve só o que vale, na
 * ordem do questionário. Chave desconhecida, tipo errado e opção fora da lista
 * recusam; pergunta escondida (a 6 sem sistema) e o texto de uma opção que não
 * foi a escolhida saem. A falha diz a pergunta, para a tela levar a pessoa até
 * ela.
 */
export function validarRespostas(entrada: unknown): { ok: true; respostas: Respostas } | Falha {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return { ok: false, pergunta: null, erro: "Pedido inválido." };
  const dados = entrada as Record<string, unknown>;
  const conhecidas = new Set(PERGUNTAS.flatMap((p) => (p.tipo === "unica" && p.comTexto ? [p.id, chaveDoTexto(p.id)] : [p.id])));
  if (Object.keys(dados).some((k) => !conhecidas.has(k))) return { ok: false, pergunta: null, erro: "Pedido inválido." };

  const saida: Respostas = {};
  for (const p of PERGUNTAS) {
    const valor = dados[p.id];
    const invalida: Falha = { ok: false, pergunta: p.id, erro: `Confira a resposta da pergunta ${p.numero}.` };
    const falta: Falha = { ok: false, pergunta: p.id, erro: `Responda a pergunta ${p.numero}.` };
    if (!visivel(p, saida)) continue;

    if (p.tipo === "texto") {
      if (valor === undefined || valor === null) continue;
      if (typeof valor !== "string") return invalida;
      const t = textoLimpo(valor, p.max);
      if (t) saida[p.id] = t;
      continue;
    }
    if (valor === undefined || valor === null || valor === "" || (Array.isArray(valor) && valor.length === 0)) return falta;

    if (p.tipo === "varias") {
      if (!Array.isArray(valor) || valor.some((v) => typeof v !== "string")) return invalida;
      const unicas = [...new Set(valor as string[])];
      if (unicas.some((v) => !p.opcoes.some((o) => o.id === v))) return invalida;
      if (unicas.length > p.max) return { ok: false, pergunta: p.id, erro: `Na pergunta ${p.numero}, escolha até ${p.max}.` };
      // Na ordem das opções, e não na do clique.
      saida[p.id] = p.opcoes.map((o) => o.id).filter((id) => unicas.includes(id));
      continue;
    }

    const opcoes = p.tipo === "escala" ? ESCALA : p.opcoes;
    if (typeof valor !== "string" || !opcoes.some((o) => o.id === valor)) return invalida;
    saida[p.id] = valor;

    if (p.tipo === "unica" && p.comTexto && valor === p.comTexto.opcao) {
      const texto = dados[chaveDoTexto(p.id)];
      if (texto !== undefined && texto !== null && typeof texto !== "string") return invalida;
      const t = typeof texto === "string" ? textoLimpo(texto, QUAL_MAX) : "";
      if (t) saida[chaveDoTexto(p.id)] = t;
    }
  }
  return { ok: true, respostas: saida };
}

/** A pergunta 30: o e-mail e as duas autorizações, cada uma marcada à parte. */
export type Contato = { email: string; resultado: boolean; conhecer: boolean; nome: string | null; academia: string | null };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * O e-mail só vale com uma autorização marcada, e a autorização só vale com o
 * e-mail. "Quero conhecer o ArkeFit" pede também o nome e o da academia. Sem
 * e-mail e sem caixa marcada, não há contato (`null`).
 */
export function validarContato(entrada: unknown): { ok: true; contato: Contato | null } | Falha {
  if (entrada === undefined || entrada === null) return { ok: true, contato: null };
  if (typeof entrada !== "object" || Array.isArray(entrada)) return { ok: false, pergunta: null, erro: "Pedido inválido." };
  const d = entrada as Record<string, unknown>;
  const texto = (v: unknown, max: number) => (typeof v === "string" ? textoLimpo(v, max) : "");
  const email = texto(d.email, 200).toLowerCase();
  const resultado = d.resultado === true;
  const conhecer = d.conhecer === true;
  const falha = (erro: string): Falha => ({ ok: false, pergunta: "contato", erro });

  if (!email && !resultado && !conhecer) return { ok: true, contato: null };
  if (!email) return falha("Informe o e-mail, ou desmarque as caixas.");
  if (!EMAIL.test(email)) return falha("Confira o e-mail.");
  if (!resultado && !conhecer) return falha("Marque para que podemos usar o e-mail, ou deixe o campo em branco.");
  if (!conhecer) return { ok: true, contato: { email, resultado, conhecer, nome: null, academia: null } };

  const nome = texto(d.nome, 120);
  const academia = texto(d.academia, 160);
  if (nome.length < 2) return falha("Informe o seu nome.");
  if (academia.length < 2) return falha("Informe o nome da academia.");
  return { ok: true, contato: { email, resultado, conhecer, nome, academia } };
}

/** O pedido inteiro, como a edge function recebe. */
export function validarPesquisa(corpo: unknown):
  | { ok: true; respostas: Respostas; contato: Contato | null }
  | (Falha & { versaoAntiga?: true }) {
  const d = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  if (d.versao !== VERSAO_QUESTIONARIO) {
    return { ok: false, pergunta: null, erro: "A pesquisa foi atualizada. Recarregue a página para responder a versão nova.", versaoAntiga: true };
  }
  // `=== false`: o app compila sem strict, e o `!r.ok` não estreita o tipo lá.
  const r = validarRespostas(d.respostas);
  if (r.ok === false) return r;
  const c = validarContato(d.contato);
  if (c.ok === false) return c;
  return { ok: true, respostas: r.respostas, contato: c.contato };
}

// ── Os resultados (Visão Master) ───────────────────────────────────────────

export type ContagemOpcao = Opcao & { total: number; pct: number };

/**
 * Quantos responderam a pergunta e quantos escolheram cada opção, com o
 * percentual sobre quem respondeu. Na de várias escolhas a soma passa de 100%.
 * Valor fora da lista (de outra versão) não conta.
 *
 * ponytail: soma todas as versões; quando houver a 2, separar por versão.
 */
export function contarOpcoes(p: Pergunta, lista: readonly Respostas[]): { responderam: number; opcoes: ContagemOpcao[] } {
  const opcoes = p.tipo === "escala" ? ESCALA : p.tipo === "texto" ? [] : p.opcoes;
  const totais = new Map(opcoes.map((o) => [o.id, 0]));
  let responderam = 0;
  for (const r of lista) {
    const v = r?.[p.id];
    const escolhidas = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && totais.has(x));
    if (!escolhidas.length) continue;
    responderam++;
    for (const e of escolhidas) totais.set(e, totais.get(e)! + 1);
  }
  return {
    responderam,
    opcoes: opcoes.map((o) => ({ ...o, total: totais.get(o.id)!, pct: responderam ? (totais.get(o.id)! / responderam) * 100 : 0 })),
  };
}

/** Os recursos, do mais "essencial" para o menos (empate: a ordem do questionário). */
export function recursosPorEssencial(lista: readonly Respostas[]) {
  return PERGUNTAS.filter((p) => p.tipo === "escala")
    .map((p) => ({ pergunta: p, ...contarOpcoes(p, lista) }))
    .sort((a, b) => b.opcoes[0].pct - a.opcoes[0].pct || a.pergunta.numero - b.pergunta.numero);
}

/** Os textos livres de uma chave (o "qual" e a pergunta 29). */
export function textosDe(chave: string, lista: readonly Respostas[]): string[] {
  return lista.map((r) => r?.[chave]).filter((t): t is string => typeof t === "string" && t.length > 0);
}

const rotuloDe = (p: Pergunta, id: string) => (p.tipo === "escala" ? ESCALA : p.tipo === "texto" ? [] : p.opcoes).find((o) => o.id === id)?.rotulo ?? id;

/**
 * O CSV das respostas: uma linha por resposta, com o rótulo de cada opção.
 * Sem e-mail: ele mora em outra tabela e não se liga à resposta.
 */
export function linhasDoCsv(linhas: readonly { versao: number; respondida_em: string; respostas: Respostas }[]): (string | number | null)[][] {
  const colunas = PERGUNTAS.flatMap((p): { chave: string; titulo: string; p: Pergunta | null }[] =>
    p.tipo === "unica" && p.comTexto
      ? [{ chave: p.id, titulo: `${p.numero}. ${p.titulo}`, p }, { chave: chaveDoTexto(p.id), titulo: `${p.numero}. Qual`, p: null }]
      : [{ chave: p.id, titulo: `${p.numero}. ${p.titulo}`, p }],
  );
  const cabecalho = ["Data", "Versão", ...colunas.map((c) => c.titulo)];
  const corpo = linhas.map((l) => [
    l.respondida_em.split("-").reverse().join("/"),
    l.versao,
    ...colunas.map(({ chave, p }) => {
      const v = l.respostas?.[chave];
      if (v === undefined) return null;
      if (!p || p.tipo === "texto") return String(v);
      return (Array.isArray(v) ? v : [v]).map((id) => rotuloDe(p, id)).join(" | ");
    }),
  ]);
  return [cabecalho, ...corpo];
}
