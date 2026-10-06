-- MIGRAÇÃO — passo 2, no projeto NOVO, depois de restaurar o schema.
--
-- O que um dump de schema do `public` NÃO traz, e por isso mora aqui:
--
--  * Os buckets de Storage. Eles são linhas em `storage.buckets`, que é dado e
--    não schema — e o schema `storage` já existe no projeto novo, então dumpá-lo
--    junto só produziria conflito.
--  * As regras de `storage.objects`. Mesma razão: a tabela é do Supabase, as
--    regras são nossas.
--  * Os tokens do Vault. O Vault cifra com uma chave que é do projeto, então
--    segredo copiado de outro projeto não decifra nunca mais. Aqui eles nascem
--    de novo. Os `if not exists` das migrations originais existem para não
--    trocar token em produção; neste arquivo a criação é incondicional, porque
--    o projeto é novo e o que estiver lá é lixo de restauração.
--  * As rotinas do pg_cron. `cron.job` pertence à extensão, e o pg_dump ignora
--    tabela de extensão. As que chamam edge function trazem a URL do projeto
--    escrita por extenso — é por isso que recriá-las é obrigatório, e não
--    opcional: restauradas como estavam, apontariam para o projeto antigo.
--
-- Os tokens e as rotinas NÃO são escritos à mão: os dois blocos entre as
-- marcas `>>>` e `<<<` são gerados por `node scripts/migracao/rotinas.mjs
-- --escrever` a partir das migrations que agendam cada rotina, na ordem da
-- reconstrução do banco. Rotina nova entra pela migration; o teste
-- `src/lib/rotinasBanco.guarda.test.ts` falha até o roteiro ser gerado de
-- novo. Até 06/10/2026 a lista era escrita aqui, com 14 rotinas, e o
-- `unschedule` de tudo apagava as outras que as migrations tinham criado.
--
-- Antes de rodar: se o projeto de destino não for lzyxqjibkfblrrjboylp, troque
-- esse endereço em todo o bloco de rotinas (cada `net.http_post` o traz).

-- ---------------------------------------------------------------- Storage ---

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('atestados',         'atestados',         false,  5242880, array['application/pdf','image/jpeg','image/png','image/webp']),
  ('avatars',           'avatars',           true,   1572864, array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('chat-videos',       'chat-videos',       false, 10485760, array['video/mp4','video/webm','video/quicktime']),
  ('dietas',            'dietas',            false,  3145728, array['image/png','image/jpeg','image/webp','application/pdf']),
  ('email-assets',      'email-assets',      true,   2097152, null),
  ('exercicio-imagens', 'exercicio-imagens', true,   5242880, array['image/png','image/jpeg','image/webp','image/gif']),
  ('exercicio-videos',  'exercicio-videos',  true,  15728640, array['video/mp4','video/webm','video/quicktime']),
  ('feed-images',       'feed-images',       true,   5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- As regras são as de 20261214010000_storage_politicas_e_limites.sql: uma por
-- operação para `authenticated`, mais a leitura pública para `anon`.
drop policy if exists "objetos: leitura pública" on storage.objects;
drop policy if exists "objetos: leitura" on storage.objects;
drop policy if exists "objetos: inclusão" on storage.objects;
drop policy if exists "objetos: alteração" on storage.objects;
drop policy if exists "objetos: exclusão" on storage.objects;

create policy "objetos: leitura pública"
  on storage.objects for select to anon
  using (
    bucket_id = any (array['avatars','email-assets','exercicio-videos','exercicio-imagens','feed-images'])
  );

create policy "objetos: leitura"
  on storage.objects for select to authenticated
  using (
    bucket_id = any (array['avatars','email-assets','exercicio-videos','exercicio-imagens','feed-images'])
    or (bucket_id = any (array['atestados','chat-videos']) and public.pode_acessar_atestado(name))
  );

create policy "objetos: inclusão"
  on storage.objects for insert to authenticated
  with check (
    (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = 'feed-images' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
        and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
    or (bucket_id = any (array['atestados','chat-videos']) and public.pode_acessar_atestado(name))
  );

create policy "objetos: alteração"
  on storage.objects for update to authenticated
  using (
    (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
        and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
    or (bucket_id = 'atestados' and public.pode_acessar_atestado(name))
  )
  with check (
    (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
        and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
    or (bucket_id = 'atestados' and public.pode_acessar_atestado(name))
  );

create policy "objetos: exclusão"
  on storage.objects for delete to authenticated
  using (
    (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = 'feed-images' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
        and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
    or (bucket_id = any (array['atestados','chat-videos']) and public.pode_acessar_atestado(name))
  );

grant execute on function public.pode_acessar_atestado(text) to authenticated;
grant execute on function public.pode_gravar_midia_exercicio(text) to authenticated;


-- ------------------------------------------------------ Tokens do Vault -----

-- >>> tokens do Vault (gerado por scripts/migracao/rotinas.mjs; não editar à mão)
-- Os 3 tokens que as rotinas leem. Nascem novos: os do projeto antigo não
-- decifram aqui, e é exatamente o desejado.
delete from vault.secrets where name in ('alerta_rotinas_token', 'briefing_semanal_token', 'reconciliacao_asaas_token');

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'alerta_rotinas_token', 'Autentica o pg_cron nas edge functions.');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'briefing_semanal_token', 'Autentica o pg_cron nas edge functions.');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'reconciliacao_asaas_token', 'Autentica o pg_cron nas edge functions.');

-- <<< tokens do Vault

-- ------------------------------------------------------------- Rotinas ------

-- >>> rotinas (gerado por scripts/migracao/rotinas.mjs; não editar à mão)
-- 30 rotinas, as mesmas que as migrations deixam agendadas. Horários em UTC,
-- como o pg_cron os guarda. Cada uma diz de que migration veio.
select cron.unschedule(jobid) from cron.job;

-- supabase/historico/20260917203102_fase2_mapa_onboarding_anamnese.sql
select cron.schedule('arke-ativacao-pendente', '0 * * * *', $cmd$select public.gerar_tarefas_ativacao_pendente();$cmd$);

-- supabase/historico/20260917212548_fase4_atendimento_automacoes_sla.sql
select cron.schedule('arke-barreira-rotina', '0 6 * * *', $cmd$select public.gerar_tarefas_barreira_rotina();$cmd$);

-- supabase/historico/20260917212548_fase4_atendimento_automacoes_sla.sql
select cron.schedule('arke-escalonamento-sla', '0 * * * *', $cmd$select public.escalar_tarefas_vencidas();$cmd$);

-- supabase/migrations/20261017010000_financeiro_completo.sql
select cron.schedule('arke-lancamentos-recorrentes', '0 5 * * *', $cmd$select public.gerar_lancamentos_recorrentes();$cmd$);

-- supabase/migrations/20261017010000_financeiro_completo.sql
select cron.schedule('arke-lancamentos-atrasados', '0 6 * * *', $cmd$select public.marcar_lancamentos_atrasados();$cmd$);

-- supabase/migrations/20261022020000_elite_diferenciais.sql
select cron.schedule('arke-acolhimento-elite', '0 7 * * *', $cmd$select public.gerar_tarefas_acolhimento_elite();$cmd$);

-- supabase/migrations/20261025030000_automacao_engajamento_baixo.sql
select cron.schedule('arke-engajamento-baixo', '0 8 * * 1', $cmd$select public.gerar_tarefas_engajamento_baixo();$cmd$);

-- supabase/migrations/20261201010000_reconciliacao_asaas.sql
select cron.schedule('arke-reconciliacao-asaas', '30 4 * * *', $cmd$
    select net.http_post(
      url := 'https://jbkrxrfdrmrkyldrrdpq.supabase.co/functions/v1/asaas-reconciliar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reconciliacao-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'reconciliacao_asaas_token')
      ),
      body := '{"modo":"varredura"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cmd$);

-- supabase/migrations/20261204010000_alerta_rotinas_email.sql
select cron.schedule('arke-alerta-rotinas', '50 * * * *', $cmd$
    select net.http_post(
      url := 'https://jbkrxrfdrmrkyldrrdpq.supabase.co/functions/v1/alertar-rotinas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$);

-- supabase/historico/20260923003248_cron_situacao_mensalidade.sql
select cron.schedule('arke-situacao-mensalidade', '30 5 * * *', $cmd$ select public.sincronizar_situacao_por_mensalidade() $cmd$);

-- supabase/historico/20260923081238_cron_avanco_fases.sql
select cron.schedule('arke-avanco-fases', '45 5 * * *', $cmd$ select public.varrer_avanco_fases() $cmd$);

-- supabase/historico/20260923084042_cron_inercia_mentor.sql
select cron.schedule('arke-inercia-mentor', '10 6 * * *', $cmd$ select public.gerar_tarefas_inercia() $cmd$);

-- supabase/historico/20260923095103_cron_briefing_semanal.sql
select cron.schedule('arke-briefing-semanal', '0 11 * * 1', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/briefing-semanal',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-briefing-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'briefing_semanal_token')
      ),
      body := '{}'::jsonb
    );
  $cmd$);

-- supabase/migrations/20261211030000_rodada5_alerta_atestado.sql
select cron.schedule('arke-alerta-atestado', '15 7 * * *', $cmd$select public.gerar_tarefas_atestado();$cmd$);

-- supabase/migrations/20261239010000_fechar_giros_pendentes.sql
select cron.schedule('arke-fechar-giros-pendentes', '7 * * * *', $cmd$select public.fechar_giros_pendentes()$cmd$);

-- supabase/migrations/20261241010000_retencao_logs_catraca.sql
select cron.schedule('arke-retencao-logs-catraca', '40 3 * * *', $cmd$select public.limpar_acessos_catraca_antigos()$cmd$);

-- supabase/migrations/20261244010000_telemetria_comandos_gateway.sql
select cron.schedule('arke-comandos-gateway', '17 * * * *', $cmd$select public.expirar_comandos_gateway()$cmd$);

-- supabase/migrations/20261251010000_alerta_catraca_gestor.sql
select cron.schedule('arke-alerta-catracas', '*/2 * * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/alertar-catracas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$);

-- supabase/migrations/20261272010000_vigia_modo_sombra.sql
select cron.schedule('arke-vigia-resumo', '0 11 * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/vigia-resumo',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$);

-- supabase/migrations/20261273010000_vigia_execucao.sql
select cron.schedule('arke-vigia-analise', '*/5 * * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/vigia',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$);

-- supabase/migrations/20261278010000_nfse_academia.sql
select cron.schedule('arke-emitir-notas', '*/10 * * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/nfse-emitir',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cmd$);

-- supabase/migrations/20261281010000_encerramento_organizacao.sql
select cron.schedule('arke-encerramentos', '40 * * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/encerramento-organizacao',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token', (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
  $cmd$);

-- supabase/migrations/20261291010000_prontidao_escala.sql
select cron.schedule('arke-retencao-historicos', '55 3 * * *', $cmd$select public.limpar_historicos_antigos()$cmd$);

-- supabase/migrations/20261298010000_agente_comercial.sql
select cron.schedule('arke-agente-comercial', '*/5 * * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/agente-comercial',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cmd$);

-- supabase/migrations/20261301010000_crm_comercial.sql
select cron.schedule('arke-retencao-leads-comerciais', '50 3 * * *', $cmd$select public.limpar_leads_comerciais_antigos()$cmd$);

-- supabase/migrations/20261315010000_agente_implantacao.sql
select cron.schedule('arke-agente-implantacao', '20 * * * *', $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/agente-implantacao',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cmd$);

-- supabase/migrations/20261340010000_prazos_da_politica.sql
select cron.schedule('arke-dados-de-passagem', '17 * * * *', $cmd$select public.limpar_dados_de_passagem()$cmd$);

-- supabase/migrations/20261353010000_troca_de_plano_sem_apagar_digital.sql
select cron.schedule('arke-remocoes-fim-de-matricula', '23 * * * *', $cmd$select public.executar_remocoes_fim_de_matricula()$cmd$);

-- supabase/migrations/20261374010000_vigia_desfecho_e_rotina_do_mrr.sql
select cron.schedule('arke-vigia', '*/5 * * * *', $cmd$select public.vigia_fechar_acoes_sem_desfecho(); select public.vigia_varrer()$cmd$);

-- supabase/migrations/20261374010000_vigia_desfecho_e_rotina_do_mrr.sql
select cron.schedule('snapshot-mrr-diario', '5 3 * * *', $cmd$select public.capturar_snapshot_mrr();$cmd$);

-- <<< rotinas

-- Nenhuma rotina pode ter sobrado apontando para o projeto antigo.
select jobname, schedule, active
  from cron.job
 where command like '%jbkrxrfdrmrkyldrrdpq%';
