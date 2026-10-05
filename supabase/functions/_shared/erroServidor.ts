// A parte pura do envio de erro das funções ao Sentry: o que relatar e o
// que vai no evento. Sem Deno nem rede, para o teste do app exercitar o código
// real (o mesmo padrão dos fluxo.ts). O envio mora em sentry.ts e o ponto de
// entrada em servir.ts.

/**
 * 500, 502 e 504 vão ao Sentry. O 503 fica de fora: é a resposta de propósito
 * de recurso desligado ou fornecedor indisponível ("Sentinela desligado").
 */
const STATUS_RELATADOS = new Set([500, 502, 504]);

export function deveRelatar(status: number): boolean {
  return STATUS_RELATADOS.has(status);
}

/** As linhas do rastro, sem a primeira (que repete a mensagem). */
function quadros(erro: unknown): { function?: string; filename?: string; lineno?: number; colno?: number }[] {
  const pilha = erro instanceof Error && typeof erro.stack === "string" ? erro.stack : "";
  const linhas = pilha.split("\n").slice(1, 16);
  const resultado = [];
  for (const l of linhas) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l);
    if (!m) continue;
    resultado.push({ function: m[1] ?? "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  // O Sentry quer o quadro mais recente por último.
  return resultado.reverse();
}

function codigoDo(erro: unknown): string | null {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(codigo) ? codigo : null;
}

/** Monta o evento. Exportado para o teste conferir o que sai e o que não sai. */
export function eventoDeErro(funcao: string, status: number, erro?: unknown, agora = new Date()) {
  const tipo = erro instanceof Error ? erro.name : erro === undefined ? "RespostaDeErro" : typeof erro;
  const codigo = codigoDo(erro);
  const frames = quadros(erro);
  return {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: agora.getTime() / 1000,
    platform: "javascript",
    level: "error",
    logger: "edge-function",
    environment: "production",
    tags: { funcao, status: String(status), runtime: "deno", ...(codigo ? { codigo } : {}) },
    message: { formatted: `${funcao} respondeu ${status}` },
    exception: {
      values: [
        {
          type: tipo,
          value: codigo ? `${funcao}: ${tipo} ${codigo}` : `${funcao}: ${tipo}`,
          ...(frames.length ? { stacktrace: { frames } } : {}),
        },
      ],
    },
    fingerprint: [funcao, String(status), tipo, codigo ?? ""],
  };
}
