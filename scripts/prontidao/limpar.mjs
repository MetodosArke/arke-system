// Devolve o banco ao tamanho de antes depois de um teste de volume.
//
// As linhas do teste somem no rollback, mas o espaço só volta com o vacuum, e
// os índices só encolhem reconstruídos. No plano gratuito, passar de 500 MB
// trava o banco em somente leitura: rodar depois de cada `rodar.mjs`.
// VACUUM FULL trava a tabela enquanto a reconstrói; com as tabelas de verdade
// ainda pequenas, é instantâneo. Com clientes em produção, não usar.
import { sql, tamanhoDoBanco } from "./banco.mjs";

const mb = (b) => `${Math.round(Number(b) / 1024 / 1024)} MB`;
console.log("antes:", mb(await tamanhoDoBanco()));
const grandes = await sql(`select c.oid::regclass::text as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'auth') and pg_total_relation_size(c.oid) > 1024 * 1024
  order by pg_total_relation_size(c.oid) desc`);
for (const { t } of grandes) {
  try {
    await sql(`vacuum full ${t}`);
  } catch (e) {
    console.log("não reconstruiu", t, String(e.message).slice(0, 100));
  }
}
console.log("depois:", mb(await tamanhoDoBanco()), `(${grandes.length} tabelas reconstruídas)`);
