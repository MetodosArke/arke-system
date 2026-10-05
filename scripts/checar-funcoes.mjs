// Verificação de tipos das edge functions com o Deno, a mesma que roda no
// deploy de verdade. O `supabase functions deploy` empacota com esbuild, que
// não confere tipo nem escopo: já passou função que quebrava na primeira
// chamada (ReferenceError) e um `.catch` numa consulta do PostgREST, que não
// é uma Promise. Roda dentro do `npm run check`, então o CI pega antes do merge.
//
// `--no-config`: sem ele o Deno acharia o package.json da raiz e passaria a
// resolver os pacotes `npm:` pelo node_modules do app, que não tem os das
// funções. `--no-lock`: o lock seria um arquivo a mais para manter, e as
// versões já vêm fixadas em cada import.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const raiz = join("supabase", "functions");
const funcoes = readdirSync(raiz, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => join(raiz, d.name, "index.ts"))
  .filter((arquivo) => existsSync(arquivo));

if (funcoes.length === 0) {
  console.error("Nenhuma edge function encontrada em supabase/functions.");
  process.exit(1);
}

const r = spawnSync("deno", ["check", "--no-lock", "--no-config", "--quiet", ...funcoes], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (r.error) {
  console.error(`Não consegui rodar o Deno: ${r.error.message}`);
  process.exit(1);
}
if (r.status === 0) console.log(`Deno: ${funcoes.length} edge functions sem erro de tipo.`);
process.exit(r.status ?? 1);
