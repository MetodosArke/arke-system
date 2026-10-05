import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O token do Gateway Local não mora em claro em lugar nenhum: o banco guarda
 * o SHA-256 (`device_token_hash`), e cada função da catraca confere o hash
 * do token que o Gateway mandou, por `hashDoTokenCatraca`. Função nova que
 * voltasse a procurar a catraca pelo token em claro não acharia nada, e a
 * tela que voltasse a ler o token não teria o que mostrar.
 */
const RAIZ = join(__dirname, "..", "..");
const FUNCOES = join(RAIZ, "supabase", "functions");

const funcoes = readdirSync(FUNCOES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => ({ nome: d.name, arquivo: join(FUNCOES, d.name, "index.ts") }))
  .filter((f) => existsSync(f.arquivo))
  .map((f) => ({ ...f, codigo: readFileSync(f.arquivo, "utf8") }));

describe("token do Gateway Local só como hash", () => {
  it("as funções da catraca foram achadas", () => {
    expect(funcoes.filter((f) => /payload\.device_token/.test(f.codigo)).length).toBeGreaterThanOrEqual(5);
  });

  it("nenhuma função procura a catraca pelo token em claro", () => {
    const emClaro = funcoes.filter((f) => /\.eq\(\s*["']device_token["']/.test(f.codigo)).map((f) => f.nome);
    expect(emClaro).toEqual([]);
  });

  it("toda função que recebe o token confere o hash dele", () => {
    const semHash = funcoes
      .filter((f) => /payload\.device_token/.test(f.codigo))
      .filter((f) => !/hashDoTokenCatraca\(/.test(f.codigo) || !/["']device_token_hash["']/.test(f.codigo))
      .map((f) => f.nome);
    expect(semHash).toEqual([]);
  });

  it("a tela não lê nem grava o token", () => {
    const tela = readFileSync(join(RAIZ, "src", "pages", "admin", "AdminCatracas.tsx"), "utf8");
    expect(tela).not.toMatch(/device_token/);
    expect(tela).toMatch(/rpc\("criar_catraca"/);
    expect(tela).toMatch(/rpc\("girar_token_catraca"/);
  });
});
