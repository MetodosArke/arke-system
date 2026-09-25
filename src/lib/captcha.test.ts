import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { interpretarSiteverify } from "../../supabase/functions/_shared/captcha";

describe("resposta do Turnstile", () => {
  it("aprovado só com success: true", () => {
    expect(interpretarSiteverify(200, { success: true })).toBe("ok");
  });

  it("token inválido é recusado, mesmo com HTTP 400", () => {
    // Era aqui que qualquer token inventado passava: o 400 virava "indisponível".
    expect(interpretarSiteverify(400, { success: false, "error-codes": ["invalid-input-response"] })).toBe("recusado");
    expect(interpretarSiteverify(200, { success: false, "error-codes": ["timeout-or-duplicate"] })).toBe("recusado");
    expect(interpretarSiteverify(400, null)).toBe("recusado");
  });

  it("Cloudflare fora do ar ou a nossa chave errada contam como indisponível", () => {
    expect(interpretarSiteverify(503, null)).toBe("indisponivel");
    expect(interpretarSiteverify(200, { success: false, "error-codes": ["internal-error"] })).toBe("indisponivel");
    expect(interpretarSiteverify(400, { success: false, "error-codes": ["invalid-input-secret"] })).toBe("indisponivel");
  });
});

describe("um lugar só para o captcha", () => {
  it("nenhuma edge function chama o siteverify por conta própria", () => {
    const raiz = join(__dirname, "..", "..", "supabase", "functions");
    const culpados: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (nome.endsWith(".ts") && nome !== "captcha.ts" && readFileSync(caminho, "utf8").includes("turnstile/v0/siteverify")) {
          culpados.push(caminho);
        }
      }
    };
    varrer(raiz);
    expect(culpados, "use verificarCaptcha de _shared/captcha.ts").toEqual([]);
  });
});
