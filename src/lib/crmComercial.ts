/**
 * Pipeline comercial da ArkeFit (Visão Master → Pipeline comercial).
 *
 * As regras do quadro moram aqui, em funções puras, para o teste exercitar o
 * que a tela faz: as etapas, os canais, a validação do contato anotado à mão,
 * a busca de duplicado e quando a Letícia pode ser acionada. Quem garante as
 * mesmas regras para qualquer caminho é o banco (`leads_comerciais`,
 * `proteger_lead_comercial`, `acionar_agente_comercial`); aqui elas viram
 * mensagem antes do clique.
 */

export const ETAPAS = [
  { id: "novo", titulo: "Novos" },
  { id: "qualificacao", titulo: "Em qualificação" },
  { id: "demonstracao", titulo: "Demo agendada" },
  { id: "negociacao", titulo: "Negociação" },
  { id: "ganho", titulo: "Ganho" },
  { id: "perdido", titulo: "Perdido" },
] as const;
export type Etapa = (typeof ETAPAS)[number]["id"];

export const ETAPAS_ABERTAS: readonly Etapa[] = ["novo", "qualificacao", "demonstracao", "negociacao"];

/**
 * Os canais. A cor de cada um foi conferida pelo validador de paleta (contraste,
 * daltonismo e separação) nos dois temas; ela vai num ponto ao lado do nome,
 * nunca no texto, e o nome está sempre escrito.
 */
export const ORIGENS = [
  { id: "site", rotulo: "Site", cor: "bg-sky-600" },
  { id: "whatsapp", rotulo: "WhatsApp", cor: "bg-emerald-600" },
  { id: "telefone", rotulo: "Telefone", cor: "bg-orange-700 dark:bg-orange-600" },
  { id: "indicacao", rotulo: "Indicação", cor: "bg-violet-600 dark:bg-violet-500" },
  { id: "prospeccao", rotulo: "Prospecção", cor: "bg-pink-600 dark:bg-pink-500" },
] as const;
export type Origem = (typeof ORIGENS)[number]["id"];
export const ORIGENS_MANUAIS = ORIGENS.filter((o) => o.id !== "site");
export const rotuloOrigem = (o: string) => ORIGENS.find((x) => x.id === o)?.rotulo ?? o;
export const corOrigem = (o: string) => ORIGENS.find((x) => x.id === o)?.cor ?? "bg-muted-foreground";

/** O que o campo "detalhe da origem" quer dizer em cada canal. */
export function rotuloDetalheOrigem(origem: string): { rotulo: string; dica: string; obrigatorio: boolean } | null {
  if (origem === "indicacao") return { rotulo: "Quem indicou", dica: "Fica só aqui. Não vai no e-mail da Letícia.", obrigatorio: false };
  if (origem === "prospeccao")
    return {
      rotulo: "Onde encontrou o contato",
      dica: "Por exemplo: Google Maps, Instagram, site da academia. Vai no primeiro e-mail da Letícia, que conta à academia de onde veio o contato.",
      obrigatorio: true,
    };
  if (origem === "site") return { rotulo: "Veio de", dica: "Campanha ou site de onde o visitante chegou.", obrigatorio: false };
  return null;
}

export const INTERESSES = [
  { id: "evasao", rotulo: "Evasão de alunos" },
  { id: "inadimplencia", rotulo: "Inadimplência" },
  { id: "catraca", rotulo: "Catraca e acesso" },
  { id: "atendimento", rotulo: "Acompanhamento dos alunos" },
  { id: "migracao", rotulo: "Troca de sistema" },
  { id: "outro", rotulo: "Outro" },
] as const;
export const rotuloInteresse = (i: string | null) => INTERESSES.find((x) => x.id === i)?.rotulo ?? null;

export const FAIXAS = [
  { id: "ate_150", rotulo: "Até 150 alunos" },
  { id: "151_500", rotulo: "151 a 500" },
  { id: "501_1000", rotulo: "501 a 1.000" },
  { id: "mais_1000", rotulo: "Mais de 1.000" },
] as const;
export const rotuloFaixa = (f: string | null) => FAIXAS.find((x) => x.id === f)?.rotulo ?? null;

export const MOTIVOS_PERDA = [
  "Preço",
  "Sem interesse agora",
  "Não respondeu",
  "Ficou com o sistema atual",
  "Escolheu outro sistema",
  "Academia pequena demais",
] as const;

// ── Cadastro à mão ─────────────────────────────────────────────────────────
export type FormularioLead = {
  academia: string;
  nome: string;
  telefone: string;
  email: string;
  cidade: string;
  uf: string;
  origem: string;
  origem_detalhe: string;
  alunos_faixa: string;
  sistema_atual: string;
  interesse: string;
  mensagem: string;
  observacoes_vendedor: string;
};

export const FORMULARIO_VAZIO: FormularioLead = {
  academia: "",
  nome: "",
  telefone: "",
  email: "",
  cidade: "",
  uf: "",
  origem: "whatsapp",
  origem_detalhe: "",
  alunos_faixa: "",
  sistema_atual: "",
  interesse: "",
  mensagem: "",
  observacoes_vendedor: "",
};

/** Celular só com dígitos, com DDD e sem o 55 do país, como o resto da base. */
export function normalizarTelefone(valor: string): string {
  let d = valor.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d;
}

const limpo = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

export type DadosLead = {
  academia: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  origem: string;
  origem_detalhe: string | null;
  alunos_faixa: string | null;
  sistema_atual: string | null;
  interesse: string | null;
  mensagem: string | null;
  observacoes_vendedor: string | null;
};

/**
 * Confere o formulário e devolve o que vai ao banco. `origemFixa` é o canal
 * de um contato do site em edição: ele não se troca, e o que a academia
 * escreveu no site não se edita (o banco recusa as duas coisas).
 */
export function validarLead(
  f: FormularioLead,
  origemFixa?: string,
): { ok: true; dados: DadosLead } | { ok: false; erro: string } {
  const academia = limpo(f.academia, 160);
  const nome = limpo(f.nome, 120);
  const telefone = normalizarTelefone(f.telefone);
  const email = limpo(f.email, 200).toLowerCase();
  const uf = limpo(f.uf, 2).toUpperCase();
  const origem = origemFixa ?? f.origem;
  const detalhe = limpo(f.origem_detalhe, 200);

  if (academia.length < 2) return { ok: false, erro: "Informe o nome da academia." };
  if (nome && nome.length < 2) return { ok: false, erro: "O nome do contato precisa de pelo menos duas letras." };
  if (!telefone && !email) return { ok: false, erro: "Informe o WhatsApp ou o e-mail: sem um dos dois não há como falar com a academia." };
  if (telefone && (telefone.length < 10 || telefone.length > 11)) return { ok: false, erro: "Informe o telefone com DDD." };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, erro: "Confira o e-mail." };
  if (uf && !/^[A-Z]{2}$/.test(uf)) return { ok: false, erro: "UF com duas letras, como SP." };
  if (!ORIGENS.some((o) => o.id === origem)) return { ok: false, erro: "Escolha por onde a academia chegou." };
  if (!origemFixa && origem === "site") return { ok: false, erro: "Contato do site entra só pelo formulário da página de vendas." };
  if (origem === "prospeccao" && detalhe.length < 2)
    return { ok: false, erro: "Na prospecção, diga onde encontrou o contato: ele vai no primeiro e-mail." };

  return {
    ok: true,
    dados: {
      academia,
      nome: nome || null,
      telefone: telefone || null,
      email: email || null,
      cidade: limpo(f.cidade, 120) || null,
      uf: uf || null,
      origem,
      origem_detalhe: detalhe || null,
      alunos_faixa: f.alunos_faixa || null,
      sistema_atual: limpo(f.sistema_atual, 80) || null,
      interesse: f.interesse || null,
      mensagem: f.mensagem.trim().slice(0, 2000) || null,
      observacoes_vendedor: f.observacoes_vendedor.trim().slice(0, 2000) || null,
    },
  };
}

// ── Duplicado ──────────────────────────────────────────────────────────────
type Contato = { id: string; academia: string; telefone: string | null; email: string | null; status: string };

/**
 * O mesmo contato já está no quadro? Compara o e-mail e os últimos 10 dígitos
 * do telefone, para "(11) 9..." e "+55 11 9..." baterem. Só avisa: a mesma
 * rede pode ter duas unidades com o mesmo dono.
 */
export function acharDuplicado<T extends Contato>(
  dados: { telefone: string | null; email: string | null },
  existentes: T[],
  ignorarId?: string,
): T | null {
  const fim = (t: string | null) => (t ? t.replace(/\D/g, "").slice(-10) : "");
  const tel = fim(dados.telefone);
  const email = dados.email?.toLowerCase() ?? "";
  return (
    existentes.find(
      (l) => l.id !== ignorarId && ((tel.length === 10 && fim(l.telefone) === tel) || (email && l.email?.toLowerCase() === email)),
    ) ?? null
  );
}

// ── Letícia ────────────────────────────────────────────────────────────────
export type ConfigLeticia = { ativo: boolean; outrasOrigens: boolean };
type LeadLeticia = {
  origem: string;
  status: string;
  email: string | null;
  agente_acionado_em: string | null;
  agente_parou_em: string | null;
};

/**
 * Por que a Letícia não pode ser acionada para este contato agora, ou nulo se
 * pode. Espelho das recusas de `acionar_agente_comercial`. Quem veio do site
 * nunca é acionado à mão: ela responde sozinha.
 */
export function motivoSemAcionar(lead: LeadLeticia, cfg: ConfigLeticia): string | null {
  if (lead.origem === "site") return "Contato do site recebe a resposta sozinho.";
  if (lead.agente_acionado_em) return "A Letícia já foi acionada para este contato.";
  if (lead.status !== "novo") return "A Letícia só fala com contatos em Novos.";
  if (!lead.email) return "Sem e-mail: a Letícia escreve por e-mail.";
  if (lead.agente_parou_em) return "Pediu para não receber mais e-mails, ou o endereço não existe.";
  if (!cfg.ativo) return "A Letícia está desligada.";
  if (!cfg.outrasOrigens) return "Aguardando a Política de Privacidade cobrir os outros canais.";
  return null;
}

/** A Letícia está (ou deveria estar) cuidando deste contato agora? */
export function leticiaCuidando(lead: LeadLeticia, cfg: ConfigLeticia): boolean {
  if (lead.status !== "novo" || lead.agente_parou_em || !lead.email || !cfg.ativo) return false;
  return lead.origem === "site" || (!!lead.agente_acionado_em && cfg.outrasOrigens);
}

// ── Números do topo ────────────────────────────────────────────────────────
type LeadNumeros = { status: string; status_desde: string };

/** Em aberto, novos, demos, ganhos em 30 dias e conversão dos fechados em 90 dias. */
export function numerosDoPipeline(leads: LeadNumeros[], agora: number = Date.now()) {
  const dias = (n: number) => agora - n * 86_400_000;
  const desde = (l: LeadNumeros) => new Date(l.status_desde).getTime();
  const fechados90 = leads.filter((l) => (l.status === "ganho" || l.status === "perdido") && desde(l) >= dias(90));
  const ganhos90 = fechados90.filter((l) => l.status === "ganho").length;
  return {
    abertos: leads.filter((l) => (ETAPAS_ABERTAS as readonly string[]).includes(l.status)).length,
    novos: leads.filter((l) => l.status === "novo").length,
    demos: leads.filter((l) => l.status === "demonstracao").length,
    ganhos30: leads.filter((l) => l.status === "ganho" && desde(l) >= dias(30)).length,
    conversao90: fechados90.length ? Math.round((ganhos90 / fechados90.length) * 100) : null,
  };
}

/** "hoje", "há 1 dia", "há 12 dias": quanto tempo o cartão está na etapa. */
export function tempoNaEtapa(statusDesde: string, agora: number = Date.now()): string {
  const d = Math.floor((agora - new Date(statusDesde).getTime()) / 86_400_000);
  if (d <= 0) return "hoje";
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** Busca sem acento em academia, nome, cidade, e-mail e telefone. */
export function combinaBusca(
  lead: { academia: string; nome: string | null; cidade: string | null; email: string | null; telefone: string | null },
  termo: string,
): boolean {
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = norm(termo.trim());
  if (!t) return true;
  const digitos = t.replace(/\D/g, "");
  return (
    [lead.academia, lead.nome, lead.cidade, lead.email].some((c) => c && norm(c).includes(t)) ||
    (digitos.length >= 4 && !!lead.telefone?.includes(digitos))
  );
}
