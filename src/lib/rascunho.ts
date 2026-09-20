/**
 * Rascunho de formulário: o trabalho digitado sobrevive a fechar a aba.
 *
 * O padrão já existia solto no onboarding do aluno (`arke_onboarding_draft:`)
 * e a importação em lote resolveu o mesmo problema no banco. Este módulo é
 * o meio-termo para o resto: conteúdo que custa caro reproduzir, mas que é
 * de uma pessoa, numa máquina, numa sessão — avaliação física com o aluno
 * na frente, ficha de treino montada exercício por exercício, dieta revisada
 * depois de uma extração de PDF que custou uma chamada de modelo.
 *
 * Deliberadamente NÃO é para todo formulário. Ressuscitar dados de ontem num
 * "novo aluno" que a pessoa abandonou de propósito é pior do que campo
 * limpo: ela não pediu aquilo de volta, e vai descobrir o engano depois de
 * salvar. A regra é persistir onde perder o trabalho dói mais do que
 * reencontrá-lo surpreende.
 *
 * Por que armazenamento do navegador e não banco: o dado ainda não é do
 * domínio — é digitação em andamento. Gravar no servidor criaria linha
 * incompleta sob RLS, visível para a equipe, que alguém teria que limpar
 * depois.
 *
 * Por que `sessionStorage` e não `localStorage`, por padrão: o rascunho
 * dura enquanto a sessão de trabalho dura. Sobrevive a refresh e a navegar
 * pelo app; morre quando a aba fecha e o terminal é desligado no fim do
 * expediente. Isso não é só ergonomia — o rascunho de uma avaliação física
 * carrega peso, dobras, dores relatadas e histórico clínico, que são dado
 * de saúde (LGPD art. 5º, II). Deixar isso no disco de um PC de recepção
 * compartilhado, indefinidamente, é exposição: o próximo turno abre o
 * navegador e encontra a medição de outra pessoa.
 *
 * O custo assumido: fechar a aba sem querer perde o rascunho. Refresh,
 * navegação e travamento do app continuam cobertos — e num equipamento
 * compartilhado esse custo vale menos que o risco.
 */

/** Só para permitir teste sem navegador. */
export interface ArmazenamentoLocal {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

const PREFIXO = "arke_rascunho:";

/** Versão do envelope — rascunho de formato antigo é descartado, não adivinhado. */
const VERSAO = 1;

interface Envelope<T> {
  v: number;
  salvoEm: string;
  dados: T;
}

/**
 * `sessao` (padrão) morre ao fechar a aba. `persistente` sobrevive — use
 * só onde o dado é da própria pessoa, no dispositivo dela, e nada sensível
 * está em jogo.
 */
export type EscopoRascunho = "sessao" | "persistente";

export function armazenamentoPadrao(escopo: EscopoRascunho = "sessao"): ArmazenamentoLocal | null {
  try {
    if (typeof window === "undefined") return null;
    const alvo = escopo === "sessao" ? window.sessionStorage : window.localStorage;
    return alvo ?? null;
  } catch {
    // Modo privado ou cookies bloqueados: acessar já lança.
    return null;
  }
}

export function chaveRascunho(escopo: string, id?: string | null): string {
  return `${PREFIXO}${escopo}${id ? `:${id}` : ""}`;
}

/**
 * Grava o rascunho. Falha em silêncio de propósito: cota cheia ou modo
 * privado não podem derrubar o formulário que a pessoa está preenchendo —
 * perder o autosave é ruim, perder a digitação é pior.
 */
export function gravarRascunho<T>(
  chave: string,
  dados: T,
  armazenamento: ArmazenamentoLocal | null = armazenamentoPadrao()
): boolean {
  if (!armazenamento) return false;
  try {
    const envelope: Envelope<T> = { v: VERSAO, salvoEm: new Date().toISOString(), dados };
    armazenamento.setItem(chave, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lê o rascunho. Devolve `null` para qualquer coisa que não seja um
 * envelope íntegro desta versão — JSON corrompido, formato antigo ou
 * conteúdo de outra origem viram descarte, nunca dado parcial entregue
 * como se fosse bom.
 */
export function lerRascunho<T>(
  chave: string,
  armazenamento: ArmazenamentoLocal | null = armazenamentoPadrao()
): { dados: T; salvoEm: Date } | null {
  if (!armazenamento) return null;
  try {
    const cru = armazenamento.getItem(chave);
    if (!cru) return null;

    const envelope = JSON.parse(cru) as Partial<Envelope<T>>;
    if (envelope?.v !== VERSAO || envelope.dados === undefined || !envelope.salvoEm) return null;

    const salvoEm = new Date(envelope.salvoEm);
    if (Number.isNaN(salvoEm.getTime())) return null;

    return { dados: envelope.dados as T, salvoEm };
  } catch {
    return null;
  }
}

export function descartarRascunho(
  chave: string,
  armazenamento: ArmazenamentoLocal | null = armazenamentoPadrao()
): void {
  if (!armazenamento) return;
  try {
    armazenamento.removeItem(chave);
  } catch {
    /* nada a fazer — o rascunho some sozinho quando o navegador limpar */
  }
}

/**
 * Um rascunho velho demais provavelmente é de outra intenção, não da tarefa
 * de agora. Oferecer "restaurar" algo de duas semanas atrás faz a pessoa
 * aceitar sem ler e descobrir o engano depois de salvar.
 */
export function rascunhoExpirado(salvoEm: Date, horasDeValidade = 48, agora = new Date()): boolean {
  const horas = (agora.getTime() - salvoEm.getTime()) / 36e5;
  return horas > horasDeValidade;
}

/** Texto curto para a tela: "salvo há 3 minutos". */
export function descreverQuandoSalvou(salvoEm: Date, agora = new Date()): string {
  const minutos = Math.floor((agora.getTime() - salvoEm.getTime()) / 60000);
  if (minutos < 1) return "salvo agora";
  if (minutos === 1) return "salvo há 1 minuto";
  if (minutos < 60) return `salvo há ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas === 1) return "salvo há 1 hora";
  if (horas < 24) return `salvo há ${horas} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "salvo ontem" : `salvo há ${dias} dias`;
}
