import { createHash, randomBytes } from "node:crypto";

/**
 * Autenticação Digest (RFC 2617, com o SHA-256 da RFC 7616), feita à mão.
 *
 * Intelbras e Hikvision administram o equipamento por HTTP com Digest. O
 * cálculo mora aqui, num lugar só, para as duas marcas assinarem do mesmo
 * jeito. Quem chama monta o pedido sobre o `http` do Node: o Digest assina o
 * caminho exato, e o caminho que sai precisa ser o que foi assinado, sem
 * normalização no meio. A senha não sai deste cálculo.
 */

export interface DesafioDigest {
  realm: string;
  nonce: string;
  qop: string | null;
  opaque: string | null;
  algorithm: string | null;
  /** O equipamento avisou que o nonce venceu: assinar de novo não é senha errada. */
  stale?: boolean;
}

/** Lê o cabeçalho `WWW-Authenticate: Digest ...` do 401. null se não for Digest. */
export function lerDesafio(cabecalho: string | null | undefined): DesafioDigest | null {
  const s = String(cabecalho ?? "");
  if (!/^\s*digest\s/i.test(s)) return null;
  // `(^|[\s,])` antes do nome: "nonce" não pode casar dentro de "cnonce".
  const campo = (nome: string) => new RegExp(`(?:^|[\\s,])${nome}="?([^",]+)"?`, "i").exec(s.replace(/^\s*digest/i, ""))?.[1] ?? null;
  const realm = campo("realm");
  const nonce = campo("nonce");
  if (!realm || !nonce) return null;
  const qop = campo("qop");
  return {
    realm,
    nonce,
    // "auth,auth-int": usamos "auth".
    qop: qop ? (qop.split(",").map((q) => q.trim()).includes("auth") ? "auth" : qop.split(",")[0].trim()) : null,
    opaque: campo("opaque"),
    algorithm: campo("algorithm"),
    stale: /^true$/i.test(campo("stale") ?? ""),
  };
}

function resumo(algoritmo: string | null): (s: string) => string {
  const nome = /^sha-?256/i.test(algoritmo ?? "") ? "sha256" : "md5";
  return (s: string) => createHash(nome).update(s).digest("hex");
}

/** O cabeçalho `Authorization: Digest ...` de um pedido. */
export function autorizacaoDigest(p: {
  usuario: string;
  senha: string;
  metodo: string;
  uri: string;
  desafio: DesafioDigest;
  nc: number;
  cnonce?: string;
}): string {
  const h = resumo(p.desafio.algorithm);
  const cnonce = p.cnonce ?? randomBytes(8).toString("hex");
  const nc = p.nc.toString(16).padStart(8, "0");
  const ha1 = h(`${p.usuario}:${p.desafio.realm}:${p.senha}`);
  const ha2 = h(`${p.metodo.toUpperCase()}:${p.uri}`);
  const resposta = p.desafio.qop
    ? h(`${ha1}:${p.desafio.nonce}:${nc}:${cnonce}:${p.desafio.qop}:${ha2}`)
    : h(`${ha1}:${p.desafio.nonce}:${ha2}`);
  const partes = [
    `username="${p.usuario}"`,
    `realm="${p.desafio.realm}"`,
    `nonce="${p.desafio.nonce}"`,
    `uri="${p.uri}"`,
    `response="${resposta}"`,
  ];
  if (p.desafio.algorithm) partes.push(`algorithm=${p.desafio.algorithm}`);
  if (p.desafio.opaque) partes.push(`opaque="${p.desafio.opaque}"`);
  if (p.desafio.qop) partes.push(`qop=${p.desafio.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${partes.join(", ")}`;
}
