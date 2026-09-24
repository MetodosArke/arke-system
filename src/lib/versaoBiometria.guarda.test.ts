import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * A versão do texto de consentimento da digital mora em dois lugares:
 * `public.versao_consentimento_biometrico()` no banco (é ela que decide se o
 * consentimento vale) e a constante do app (é ela que decide o que a tela
 * mostra). Se divergirem, a tela diz "autorizado" para um consentimento que o
 * banco já não aceita — e a recepção tenta cadastrar a digital e leva erro sem
 * entender por quê. Lido do código-fonte, e não importado, porque o
 * componente puxa o cliente do Supabase.
 */
describe("versão do consentimento biométrico", () => {
  it("o app e o banco estão na mesma versão do texto", () => {
    const dir = "supabase/migrations";
    const ultima = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .filter((s) => s.includes("function public.versao_consentimento_biometrico"))
      .pop();
    const doBanco = ultima?.match(/versao_consentimento_biometrico\(\)[\s\S]*?select '([^']+)'::text/)?.[1];

    const componente = readFileSync("src/components/catraca/ConsentimentoBiometria.tsx", "utf8");
    const doApp = componente.match(/VERSAO_CONSENTIMENTO_BIOMETRIA = "([^"]+)"/)?.[1];

    expect(doBanco).toBeTruthy();
    expect(doApp).toBe(doBanco);
  });
});
