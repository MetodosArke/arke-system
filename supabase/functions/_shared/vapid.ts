import { Buffer } from "node:buffer";
import { createECDH } from "node:crypto";

/**
 * A chave pública VAPID, derivada da privada (`VAPID_PRIVATE_KEY`). O projeto
 * não guarda a pública como segredo à parte: ela sai sempre da privada, e
 * assim as duas nunca ficam de pares diferentes.
 *
 * Foi por ler um `VAPID_PUBLIC_KEY` que não existe que o aviso do resumo
 * semanal nunca chegou ao celular do gestor: a chave ia vazia, o web-push
 * recusava, e o erro era engolido junto com o de inscrição expirada.
 * `src/lib/vapid.guarda.test.ts` barra a leitura dessa variável.
 */
export function chavePublicaVapid(privada: string): string {
  const ecdh = createECDH("prime256v1");
  const normalizada = privada.replace(/-/g, "+").replace(/_/g, "/");
  ecdh.setPrivateKey(Buffer.from(normalizada + "=".repeat((4 - (normalizada.length % 4)) % 4), "base64"));
  return Buffer.from(ecdh.getPublicKey(undefined, "uncompressed")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
