-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Briefing executivo do gestor, toda segunda.
--
-- 11:00 UTC = 08:00 de Brasilia: o dono da academia abre o WhatsApp no comeco
-- da segunda, nao de madrugada. `cron.timezone` esta em GMT, entao o horario
-- aqui e UTC mesmo — e por isso esta escrito.
--
-- Depois das rotinas da manha (ate 06:10 UTC), para os numeros do briefing ja
-- refletirem a fila que a celula montou no mesmo dia.
select cron.schedule(
  'arke-briefing-semanal',
  '0 11 * * 1',
  $$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/briefing-semanal',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-briefing-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'briefing_semanal_token')
      ),
      body := '{}'::jsonb
    );
  $$
);
