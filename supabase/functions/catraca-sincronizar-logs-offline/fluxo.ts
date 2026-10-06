// Regras puras da sincronização dos acessos offline, sem Deno nem Supabase:
// o teste do app (src/lib/logsOfflineCatraca.test.ts) exercita este código, e
// não uma cópia.
//
// Antes de 06/10/2026 a função gravava o lote numa instrução só, sem conferir
// as linhas. Um registro com problema derrubava o lote inteiro — o aluno
// excluído durante a queda de internet (chave estrangeira), um `cpf_consultado`
// que não era texto (`.replace` lançava), uma data torta — e o Gateway, que só
// tira da fila o que a nuvem aceitou, reenviava os mesmos 500 a cada 30 s, para
// sempre: a fila daquela catraca parava. E um `aluno_id` de outra academia era
// gravado com a academia da catraca, virando presença.
//
// Agora cada linha é conferida; as válidas são gravadas, e a resposta diz ao
// Gateway, pelo `id_local` de cada uma, o que foi aceito e o que foi recusado
// de vez. As duas saem da fila. O que a resposta não citar fica para a próxima.

export const RESULTADOS_VALIDOS: ReadonlySet<string> = new Set([
  "liberado",
  "negado_inadimplente",
  "negado_pausado",
  "negado_matricula_encerrada",
  "negado_nao_encontrado",
  "negado_catraca_inativa",
  "negado_sem_agendamento",
  "negado_falha_verificacao_agendamento",
]);

// Desfecho físico do giro, quando o equipamento informa. Na contingência o
// gateway só enfileira o acesso depois de saber o desfecho, então ele chega
// junto — e a presença (gatilho trg_presenca_pela_catraca) sai do mesmo jeito
// que no caminho online. "pendente" (o giro não fechou antes do envio) vira
// nulo, como sempre foi: conta presença.
export const GIROS_VALIDOS: ReadonlySet<string> = new Set(["confirmado", "desistencia", "sem_confirmacao"]);

/**
 * Até quando um acesso decidido offline ainda sobe. O Gateway guarda o que já
 * entregou por 30 dias; um acesso mais velho que isso não é queda de internet,
 * é relógio errado ou registro esquecido, e viraria presença de um mês atrás.
 */
export const JANELA_PASSADO_MS = 30 * 24 * 3600_000;
/** Relógio do computador um pouco adiantado passa; acesso "do futuro" além disso, não. */
export const TOLERANCIA_FUTURO_MS = 10 * 60_000;
export const MAXIMO_POR_LOTE = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O motivo da recusa, curto e sem dado pessoal: vai para o log do Gateway. */
export type MotivoDescarte =
  | "registro inválido"
  | "resultado desconhecido"
  | "credencial inválida"
  | "data inválida"
  | "data fora da janela"
  | "aluno inválido"
  | "aluno não é desta academia"
  | "recusado pelo banco";

export type Descarte = { id_local: string | null; motivo: MotivoDescarte };

export type LinhaLog = {
  organization_id: string;
  catraca_id: string;
  aluno_id: string | null;
  cpf_consultado: string;
  resultado: string;
  validado_offline: true;
  created_at: string;
  giro: string | null;
};

export type LinhaConferida = { id_local: string | null; linha: LinhaLog };

type Objeto = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);

/** O id do registro na fila do Gateway (desde a 1.9). Gateway antigo não manda. */
export function idLocal(log: unknown): string | null {
  if (!ehObjeto(log)) return null;
  const id = log.id_local;
  return typeof id === "string" && id.length > 0 && id.length <= 64 ? id : null;
}

/** Os alunos citados no lote, para conferir de uma vez se são da academia. */
export function alunosCitados(logs: unknown[]): string[] {
  const ids = new Set<string>();
  for (const l of logs) {
    if (ehObjeto(l) && typeof l.aluno_id === "string" && UUID.test(l.aluno_id)) ids.add(l.aluno_id.toLowerCase());
  }
  return [...ids];
}

/**
 * A credencial do registro, no formato do caminho online: o CPF só com os
 * dígitos, ou `id:<número no equipamento>`. Até 06/10/2026 o `id:` era
 * apagado aqui junto com o resto que não fosse dígito, e o acesso por cartão
 * ou digital decidido offline aparecia na Visão Master como acesso por CPF.
 */
export function credencialDoLog(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  if (v.startsWith("id:")) {
    const numero = v.slice(3).trim();
    return numero.length > 0 && numero.length <= 64 && /^[\x21-\x7e]+$/.test(numero) ? `id:${numero}` : null;
  }
  const digitos = v.replace(/\D/g, "");
  return digitos.length > 0 && digitos.length <= 14 ? digitos : null;
}

/** Em lotes: uma lista longa de ids no `.in()` não cabe no endereço da consulta. */
export function emLotes<T>(lista: T[], tamanho = 200): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

/**
 * Confere cada registro. `alunosDaAcademia` são os ids (em minúsculas) dos
 * alunos citados que existem e são da academia da catraca.
 */
export function conferirLogs(
  logs: unknown[],
  ctx: { organizationId: string; catracaId: string; agora: Date; alunosDaAcademia: ReadonlySet<string> },
): { linhas: LinhaConferida[]; descartados: Descarte[] } {
  const linhas: LinhaConferida[] = [];
  const descartados: Descarte[] = [];
  const agora = ctx.agora.getTime();

  for (const log of logs) {
    const id_local = idLocal(log);
    const recusar = (motivo: MotivoDescarte) => descartados.push({ id_local, motivo });
    if (!ehObjeto(log)) {
      recusar("registro inválido");
      continue;
    }
    if (typeof log.resultado !== "string" || !RESULTADOS_VALIDOS.has(log.resultado)) {
      recusar("resultado desconhecido");
      continue;
    }
    const credencial = credencialDoLog(log.cpf_consultado);
    if (!credencial) {
      recusar("credencial inválida");
      continue;
    }
    const quando = typeof log.ocorrido_em === "string" ? Date.parse(log.ocorrido_em) : Number.NaN;
    if (Number.isNaN(quando)) {
      recusar("data inválida");
      continue;
    }
    if (quando < agora - JANELA_PASSADO_MS || quando > agora + TOLERANCIA_FUTURO_MS) {
      recusar("data fora da janela");
      continue;
    }
    let alunoId: string | null = null;
    if (log.aluno_id !== undefined && log.aluno_id !== null) {
      if (typeof log.aluno_id !== "string" || !UUID.test(log.aluno_id)) {
        recusar("aluno inválido");
        continue;
      }
      alunoId = log.aluno_id.toLowerCase();
      // Excluído durante a queda, ou de outra academia: não é presença de
      // ninguém aqui. Gravar com a academia da catraca daria presença a quem
      // não é dela; gravar sem o aluno guardaria o CPF de quem foi excluído.
      if (!ctx.alunosDaAcademia.has(alunoId)) {
        recusar("aluno não é desta academia");
        continue;
      }
    }
    linhas.push({
      id_local,
      linha: {
        organization_id: ctx.organizationId,
        catraca_id: ctx.catracaId,
        aluno_id: alunoId,
        cpf_consultado: credencial,
        resultado: log.resultado,
        validado_offline: true,
        created_at: new Date(quando).toISOString(),
        giro: typeof log.giro === "string" && GIROS_VALIDOS.has(log.giro) ? log.giro : null,
      },
    });
  }
  return { linhas, descartados };
}

/**
 * Erro do banco que é da linha (dado ou regra: classes 22 e 23 do Postgres),
 * e não da conexão. Linha assim não entra nunca, por mais que se tente; erro
 * de conexão entra na próxima.
 */
export function erroDaLinha(codigo: string | null | undefined): boolean {
  return typeof codigo === "string" && /^2[23]/.test(codigo);
}
