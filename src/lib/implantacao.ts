/**
 * A implantação da academia, do lado da tela: o painel da gestão, o cartão
 * da tela inicial e a página da ArkeFit na Visão Master. O que está pronto
 * vem do banco (`get_implantacao_organizacao`, `get_superadmin_implantacoes`);
 * aqui ficam os nomes, a ordem e as contas de tela.
 *
 * Quem age é o Bruno, o agente de implantação (edge function
 * `agente-implantacao`), de hora em hora. `diaUtilDepois` espelha a regra
 * dele (supabase/functions/agente-implantacao/fluxo.ts), e o teste confere
 * que as duas dão a mesma resposta.
 */

export type EtapaImplantacao = {
  etapa: string;
  ordem: number;
  principal: boolean;
  concluida: boolean;
  detalhe: string | null;
};

export type MensagemImplantacao = { tipo: string; etapa: string | null; motivo: string; enviado_em: string };

export type Implantacao = {
  etapas: EtapaImplantacao[];
  iniciada_em: string;
  etapa_atual: string | null;
  etapa_atual_desde: string | null;
  concluida_em: string | null;
  slug: string;
  agente_ativo: boolean;
  mensagens: MensagemImplantacao[];
  evasao_janela: { inicio: string; fim: string };
  evasao: { mes: string; alunos_inicio: number; saidas: number }[];
};

/** O nome de cada etapa, como aparece para a gestão e para a ArkeFit. */
export const TITULO_ETAPA: Record<string, string> = {
  dados: "Dados da academia",
  recebimentos: "Conta de recebimentos",
  planos: "Planos e preços",
  equipe: "Equipe",
  alunos: "Alunos",
  contrato: "Contrato",
  liberacao: "Liberar o app",
  primeira_entrada: "Primeira entrada",
  primeiro_aluno_app: "Primeiro aluno no app",
  lancamento: "Lançamento",
  evasao_anterior: "Evasão dos 6 meses anteriores",
  asaas_aprovada: "Aprovação da conta Asaas",
};

export const ROTULO_MENSAGEM: Record<string, string> = {
  boas_vindas: "Boas-vindas com o primeiro passo",
  proximo_passo: "Próximo passo",
  lembrete: "Lembrete da etapa parada",
  pedido_evasao: "Pedido da evasão anterior",
  asaas_aprovada: "Aviso: conta Asaas aprovada",
  asaas_recusada: "Aviso: conta Asaas recusada",
  kit_lancamento: "Kit de lançamento",
  chamado_arkefit: "Chamado para a ArkeFit ligar",
};

export function tituloEtapa(etapa: string | null | undefined): string {
  return etapa ? TITULO_ETAPA[etapa] ?? etapa : "—";
}

export function principais(etapas: EtapaImplantacao[]): EtapaImplantacao[] {
  return etapas.filter((e) => e.principal).sort((a, b) => a.ordem - b.ordem);
}

export function andamento(etapas: EtapaImplantacao[]): { feitas: number; total: number; percentual: number } {
  const p = principais(etapas);
  const feitas = p.filter((e) => e.concluida).length;
  return { feitas, total: p.length, percentual: p.length ? Math.round((feitas / p.length) * 100) : 0 };
}

export function proximaDaImplantacao(etapas: EtapaImplantacao[]): EtapaImplantacao | null {
  return principais(etapas).find((e) => !e.concluida) ?? null;
}

// ── O "1 dia útil" do agente, em Brasília ─────────────────────────────────

const FORMATO = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DIA_MS = 86_400_000;

function diaDaSemana(d: Date): { data: string; dia: number } {
  const p = Object.fromEntries(FORMATO.formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, dia: DIAS[p.weekday] };
}

/** Espelho de `diaUtilDepois` do agente: sexta vence na segunda; o fim de semana não conta. */
export function diaUtilDepois(desde: Date): Date {
  let inicio = desde;
  const b = diaDaSemana(inicio);
  if (b.dia === 6 || b.dia === 0) {
    const [a, m, d] = b.data.split("-").map(Number);
    inicio = new Date(Date.UTC(a, m - 1, d + (b.dia === 6 ? 2 : 1), 3, 0, 0));
  }
  let fim = new Date(inicio.getTime() + DIA_MS);
  const f = diaDaSemana(fim).dia;
  if (f === 6) fim = new Date(fim.getTime() + 2 * DIA_MS);
  else if (f === 0) fim = new Date(fim.getTime() + DIA_MS);
  return fim;
}

/** Quantos dias úteis inteiros a etapa está parada. */
export function diasUteisParada(desde: string | null, agora: Date = new Date()): number {
  if (!desde) return 0;
  let n = 0;
  let d = new Date(desde);
  for (;;) {
    const proximo = diaUtilDepois(d);
    if (proximo > agora || n > 365) return n;
    n++;
    d = proximo;
  }
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Os 6 meses da janela, de "2026-04-01" a "2026-09-01", como "2026-04". */
export function mesesDaJanela(inicio: string, fim: string): string[] {
  const [ai, mi] = inicio.split("-").map(Number);
  const [af, mf] = fim.split("-").map(Number);
  const meses: string[] = [];
  for (let a = ai, m = mi; a < af || (a === af && m <= mf); m === 12 ? ((m = 1), a++) : m++) {
    meses.push(`${a}-${String(m).padStart(2, "0")}`);
    if (meses.length > 12) break;
  }
  return meses;
}

export function rotuloMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]}/${String(a).slice(2)}`;
}

/** A evasão média dos meses informados, em %: saídas sobre os ativos no começo do mês. */
export function evasaoMedia(meses: { alunos_inicio: number; saidas: number }[]): number | null {
  const validos = meses.filter((m) => m.alunos_inicio > 0);
  if (!validos.length) return null;
  return validos.reduce((s, m) => s + m.saidas / m.alunos_inicio, 0) / validos.length * 100;
}
