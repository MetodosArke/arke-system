// Acesso ao banco pela API de gerenciamento do Supabase, com o token do
// arquivo de chaves (variável ARKE_CHAVES, linha que começa com "sbp_").
import { readFileSync } from "node:fs";

export const PROJETO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const linhas = readFileSync(process.env.ARKE_CHAVES ?? "", "utf8").split(/\r?\n/).map((s) => s.trim());
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || linhas.find((l) => l.startsWith("sbp_"));
if (!TOKEN) throw new Error("Sem token de acesso (sbp_) em ARKE_CHAVES.");

export async function sql(consulta) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: consulta }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 4000));
  return t.trim() ? JSON.parse(t) : null;
}

export const tamanhoDoBanco = async () => (await sql(`select pg_database_size(current_database())::bigint as b`))[0].b;
