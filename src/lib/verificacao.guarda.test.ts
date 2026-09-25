import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava de `supabase/functions/_shared/verificacao.ts`: o papel da ArkeFit
 * (Super Admin, Admin ARKE) só vale numa sessão verificada em duas etapas.
 * O banco exige isso em `has_role`; as edge functions conferem o papel pela
 * tabela, com a service_role, e por isso precisam exigir por conta própria.
 * Função nova que decide pelo papel da ArkeFit sem `verificada()` funciona em
 * todo teste — e reabre a porta que uma senha vazada abriria.
 */
const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (nome.endsWith(".ts")) achados.push(caminho);
  }
  return achados;
}

const PAPEL_ARKE = /role\s*===\s*"(superadmin|admin_arke)"/;

describe("verificação em duas etapas nas edge functions", () => {
  const codigos = arquivos(FUNCOES).map((c) => ({ nome: c.slice(FUNCOES.length + 1).replace(/\\/g, "/"), codigo: readFileSync(c, "utf8") }));

  it("o detector detecta (há funções que decidem pelo papel da ArkeFit)", () => {
    expect(codigos.filter((c) => PAPEL_ARKE.test(c.codigo)).length).toBeGreaterThan(5);
  });

  it("toda função que decide pelo papel da ArkeFit exige a sessão verificada", () => {
    const sem = codigos.filter((c) => PAPEL_ARKE.test(c.codigo) && !/verificada\(/.test(c.codigo)).map((c) => c.nome);
    expect(sem, "use verificada(claims) de _shared/verificacao.ts").toEqual([]);
  });
});
