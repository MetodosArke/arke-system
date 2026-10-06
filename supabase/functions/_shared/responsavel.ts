// O aceite do responsável legal do aluno menor (decisão do responsável,
// 06/10/2026): o que as duas funções do caminho dividem — `responsavel-pedido`
// (o aluno ou a recepção pedem; sai o e-mail) e `responsavel-aceite` (a página
// pública do link).
//
// Sem Deno e sem Supabase, para o teste do app exercitar o código real.

export const PROPOSITOS_RESPONSAVEL = ["saude", "biometria", "ia_anamnese", "ia_chat"] as const;
export type PropositoResponsavel = (typeof PROPOSITOS_RESPONSAVEL)[number];

export const ehProposito = (p: unknown): p is PropositoResponsavel =>
  typeof p === "string" && (PROPOSITOS_RESPONSAVEL as readonly string[]).includes(p);

/** O nome de cada propósito no e-mail. O mesmo de `ROTULO_PROPOSITO` no app (o teste confere). */
export const ROTULO_PROPOSITO: Record<PropositoResponsavel, string> = {
  saude: "Dados de saúde (anamnese)",
  biometria: "Digital e rosto na catraca",
  ia_anamnese: "Resumo da anamnese por inteligência artificial",
  ia_chat: "Inteligência artificial no apoio às respostas do mentor",
};

/**
 * A versão e o SHA-256 do texto que a página do responsável mostra, por
 * propósito. O texto mora no app (`src/lib/textosConsentimento.ts`, que junta
 * os termos que já existem); `textosConsentimento.test.ts` recalcula o hash e
 * falha se o texto mudar sem esta tabela mudar junto. A versão é a mesma de
 * `public.versao_proposito_responsavel()`, que o banco confere no aceite.
 *
 * É o servidor que grava o hash, e não a página: o aceite registra o texto que
 * o sistema mostrou, e não um número que o navegador mandou.
 */
export const TEXTOS_RESPONSAVEL: Record<PropositoResponsavel, { versao: string; sha256: string }> = {
  saude: { versao: "2026-09-23", sha256: "7917bba2d63139fcd507e40d98667254e897afd51091d8c4b4b6a3c691720bc1" },
  biometria: { versao: "2026-10-03", sha256: "72b7b71db4cc6355a8e834509eee84ee0987aea37b4ed026f0c998157e1d5b5f" },
  ia_anamnese: { versao: "2026-09-23.4", sha256: "2ed0994c040636d6fc4e03e633d1b01152873c37d6a4dde2ac769952bcc100b8" },
  ia_chat: { versao: "2026-09-23.4", sha256: "e01ab8cfd98136124d012471e6abfccc3cba244ed81d3e521e488c9438d831f3" },
};

/** O link vale 7 dias: o mesmo prazo do banco (`responsavel_pedidos.expira_em`). */
export const PRAZO_DIAS = 7;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** 32 bytes aleatórios em base64url: o segredo do link, que só existe no e-mail. */
export function gerarTokenResponsavel(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * SHA-256 do token, em hexadecimal — o que o banco guarda e procura. Null para
 * o que nem tem formato de token: a função responde "link inválido" sem
 * consultar o banco.
 */
export async function hashDoTokenResponsavel(token: string | null | undefined): Promise<string | null> {
  const t = (token ?? "").trim();
  if (!TOKEN.test(t)) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Nome e e-mail do responsável: o erro para mostrar, ou null. O banco confere de novo. */
export function erroDadosResponsavel(nome: unknown, email: unknown): string | null {
  const n = typeof nome === "string" ? nome.trim().replace(/\s+/g, " ") : "";
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (n.length < 3 || n.length > 120 || !n.includes(" ")) return "Informe o nome completo do responsável.";
  if (!EMAIL.test(e) || e.length > 254) return "E-mail do responsável inválido.";
  return null;
}
