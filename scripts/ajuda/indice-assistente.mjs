// Atualiza o índice da Central de Ajuda que o assistente da academia usa
// (supabase/functions/assistente-academia/artigos.json). O teste monta o
// índice a partir dos artigos e, com ATUALIZAR_INDICE=1, grava o arquivo.
// Depois de atualizar, publique a função: npx supabase functions deploy assistente-academia
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["vitest", "run", "src/lib/assistenteAcademia.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ATUALIZAR_INDICE: "1" },
});
process.exit(r.status ?? 1);
