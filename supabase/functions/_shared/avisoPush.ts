// As regras do aviso no celular, sem Deno nem web-push, para o teste do app
// exercitar o código real. O envio mora em push.ts.

/** Quantos avisos saem ao mesmo tempo. Um comunicado para 400 alunos não espera um por um, nem abre 400 conexões. */
export const LOTE_PUSH = 25;

/**
 * Por quanto tempo o serviço de push (Google, Apple, Mozilla) guarda o aviso
 * para o aparelho desligado. Passado o prazo, o aviso é descartado: a mensagem
 * de chat de ontem não aparece amanhã como se fosse nova.
 */
export const VALIDADE_SEG = {
  chat: 12 * 3600,
  resumoSemanal: 3 * 86400,
  comunicadoSemData: 3 * 86400,
  comunicadoMinimo: 3600,
  comunicadoMaximo: 7 * 86400,
};

export type Urgencia = "very-low" | "low" | "normal" | "high";
export type OpcoesAviso = { validadeSeg: number; topico?: string | null; urgencia?: Urgencia };

const CONVERSA = /^(treino|dieta):([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

/**
 * O agrupamento de uma conversa (`treino:<aluno>` ou `dieta:<dieta>`).
 *   - A etiqueta vai no aviso: no aparelho, o aviso novo da mesma conversa
 *     substitui o anterior, em vez de empilhar dez avisos de dez mensagens.
 *   - O tópico vai no cabeçalho do push: com o aparelho desligado, o serviço
 *     de push guarda só o último aviso da conversa. São os 32 caracteres do
 *     id, o máximo que o cabeçalho aceita.
 */
export function agrupamentoDaConversa(conversa: unknown): { etiqueta: string; topico: string } | null {
  if (typeof conversa !== "string") return null;
  const m = CONVERSA.exec(conversa.trim());
  if (!m) return null;
  const hex = (m[2] + m[3] + m[4] + m[5] + m[6]).toLowerCase();
  return { etiqueta: `${m[1].toLowerCase()}:${hex}`, topico: hex };
}

/** O tópico de um aviso pelo id (uuid) do assunto: os 32 caracteres sem os hífens. */
export function topicoDoId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const hex = id.trim().toLowerCase().replace(/-/g, "");
  return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

/** Validade do aviso de um comunicado: até ele expirar, entre 1 hora e 7 dias. */
export function validadeDoComunicado(expiraEm: string | null | undefined, agora = Date.now()): number {
  if (!expiraEm) return VALIDADE_SEG.comunicadoSemData;
  const fim = new Date(expiraEm).getTime();
  if (!Number.isFinite(fim)) return VALIDADE_SEG.comunicadoSemData;
  const seg = Math.floor((fim - agora) / 1000);
  return Math.min(VALIDADE_SEG.comunicadoMaximo, Math.max(VALIDADE_SEG.comunicadoMinimo, seg));
}

export function emLotes<T>(itens: T[], tamanho = LOTE_PUSH): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * A inscrição não existe mais e sai do banco: o aparelho foi trocado, o app
 * desinstalado ou a permissão retirada (404 e 410), ou ela foi feita com
 * outra chave VAPID (403).
 */
export function inscricaoMorta(status: number | undefined, corpo: string | undefined): boolean {
  if (status === 404 || status === 410) return true;
  return status === 403 && (corpo ?? "").toLowerCase().includes("vapid credentials");
}
