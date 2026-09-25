import { describe, it, expect } from "vitest";
import { createECDH } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chavePublicaVapid } from "../../supabase/functions/_shared/vapid";

const base64Url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");

describe("chave pública VAPID", () => {
  it("sai da privada, e é a do mesmo par", () => {
    const par = createECDH("prime256v1");
    par.generateKeys();
    const publica = chavePublicaVapid(base64Url(par.getPrivateKey()));
    expect(publica).toBe(base64Url(par.getPublicKey()));
    // O web-push exige 65 bytes: o formato não comprimido começa com 0x04.
    const bytes = Buffer.from(publica.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });

  it("nenhuma edge function lê a chave pública do ambiente", () => {
    // O segredo VAPID_PUBLIC_KEY não existe no projeto: quem o lia mandava a
    // chave vazia, e o aviso não saía sem erro nenhum.
    const raiz = join(__dirname, "..", "..", "supabase", "functions");
    const culpados: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (nome.endsWith(".ts") && /Deno\.env\.get\(\s*["']VAPID_PUBLIC_KEY["']\s*\)/.test(readFileSync(caminho, "utf8"))) culpados.push(caminho);
      }
    };
    varrer(raiz);
    expect(culpados).toEqual([]);
  });
});
