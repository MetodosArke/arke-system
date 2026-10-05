# Histórico do banco

O banco de produção foi construído por uma sequência de migrations cuja ordem e cujo texto nem sempre batem com `supabase/migrations/`: o repositório renumerou boa parte delas, juntou algumas que rodaram em partes, e alguns arquivos ficaram com texto um pouco diferente do que rodou. Esta pasta guarda o retrato fiel, para o repositório bastar se um dia for preciso recriar o banco do zero, sem backup.

- `ordem.json`: cada migration desde `reset_schema_public`, em ordem de versão, apontando para o arquivo com o texto que rodou. É o arquivo de `supabase/migrations/` quando o texto bate, ou a cópia fiel desta pasta quando faltava ou diferia.
- `<versão>_<nome>.sql`: as cópias fiéis, tiradas de `supabase_migrations.schema_migrations`. Não editar à mão.
- `fora_da_ordem` (em `ordem.json`): os arquivos de `supabase/migrations/` que a reconstrução não usa, com o motivo.

Migration nova, aplicada depois do retrato, entra pela versão: tudo em `supabase/migrations/` com versão maior que `ultima_versao`, em ordem.

**Para renovar o retrato:** `ARKE_CHAVES=... node scripts/migracao/historico.mjs`. O teste `src/lib/historicoBanco.guarda.test.ts` confere que todo arquivo citado existe e que todo arquivo de `supabase/migrations/` está no histórico, fora da ordem com motivo, ou depois do retrato.

**Para reconstruir:** num projeto vazio, as extensões de `scripts/migracao/01-antes-da-restauracao.sql`, depois `ARKE_ORIGEM=repositorio ARKE_DESTINO=<projeto> node scripts/migracao/replicar-schema.mjs --aplicar`, e por fim `02-depois-da-restauracao.sql` (buckets, rotinas do pg_cron e tokens do Vault, que não saem em migration). Dados não estão aqui: vêm do backup.
