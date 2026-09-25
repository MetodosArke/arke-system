/**
 * Verificação do Cloudflare Turnstile para os endpoints públicos (matrícula
 * pública, primeiro acesso, contato da página de vendas).
 *
 * **Falha aberta só quando o Cloudflare de fato não respondeu.** A versão
 * anterior tratava qualquer resposta sem HTTP 200 como "indisponível" e
 * liberava — mas o siteverify responde **400** para token inválido, com
 * `success: false` e `invalid-input-response`. Resultado: qualquer token
 * inventado passava pelo captcha nos três endpoints (achado em 25/09/2026).
 * Agora quem decide é o corpo da resposta: token recusado é recusado, com
 * qualquer status; só erro de rede, 5xx, `internal-error` ou a nossa própria
 * chave inválida contam como indisponível — a última porque é configuração
 * nossa, e travar todo cadastro por ela trocaria um risco pequeno por uma
 * falha certa.
 */

export type ResultadoCaptcha = "ok" | "recusado" | "indisponivel";

const PROBLEMA_NOSSO = ["missing-input-secret", "invalid-input-secret", "internal-error"];

/** Decide pelo que o siteverify respondeu. Sem Deno, para o teste do app. */
export function interpretarSiteverify(status: number, corpo: unknown): ResultadoCaptcha {
  const dados = (corpo ?? {}) as { success?: unknown; "error-codes"?: unknown };
  if (dados.success === true) return "ok";
  const codigos = Array.isArray(dados["error-codes"]) ? (dados["error-codes"] as string[]) : [];
  if (status >= 500 || codigos.some((c) => PROBLEMA_NOSSO.includes(c))) return "indisponivel";
  if (dados.success === false) return "recusado";
  // Corpo sem o formato do siteverify: não dá para afirmar que recusou.
  return status >= 400 && status < 500 ? "recusado" : "indisponivel";
}

export async function verificarCaptcha(token: string | undefined | null, ip: string | null, segredo: string): Promise<ResultadoCaptcha> {
  if (!token) return "recusado";
  const corpo = new FormData();
  corpo.append("secret", segredo);
  corpo.append("response", token);
  if (ip) corpo.append("remoteip", ip);
  let resp: Response;
  try {
    resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: corpo,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return "indisponivel";
  }
  let dados: unknown = null;
  try {
    dados = await resp.json();
  } catch {
    // corpo que não é JSON
  }
  const resultado = interpretarSiteverify(resp.status, dados);
  if (resultado === "indisponivel") {
    const codigos = (dados as { "error-codes"?: unknown } | null)?.["error-codes"];
    console.error("captcha: siteverify indisponível ou chave inválida", resp.status, Array.isArray(codigos) ? codigos.join(",") : "");
  }
  return resultado;
}
