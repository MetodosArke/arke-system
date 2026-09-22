-- MIGRAÇÃO — passo 2, no projeto NOVO, depois de restaurar o schema.
--
-- O que um dump de schema do `public` NÃO traz, e por isso mora aqui:
--
--  * Os buckets de Storage. Eles são linhas em `storage.buckets`, que é dado e
--    não schema — e o schema `storage` já existe no projeto novo, então dumpá-lo
--    junto só produziria conflito.
--  * As regras de `storage.objects`. Mesma razão: a tabela é do Supabase, as
--    regras são nossas.
--  * As rotinas do pg_cron. `cron.job` pertence à extensão, e o pg_dump ignora
--    tabela de extensão. As três que chamam edge function trazem a URL do
--    projeto escrita por extenso — é por isso que recriá-las é obrigatório, e
--    não opcional: restauradas como estavam, apontariam para o projeto antigo.
--  * Os tokens do Vault. O Vault cifra com uma chave que é do projeto, então
--    segredo copiado de outro projeto não decifra nunca mais. Aqui eles nascem
--    de novo. Os `if not exists` das migrations originais existem para não
--    trocar token em produção; neste arquivo a criação é incondicional, porque
--    o projeto é novo e o que estiver lá é lixo de restauração.
--
-- Antes de rodar: se o projeto de destino não for lzyxqjibkfblrrjboylp, troque
-- as três URLs no fim do arquivo.

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

-- Nascem novos. Depois de rodar este arquivo, os tokens do projeto antigo não
-- valem mais aqui — o que é exatamente o desejado.
delete from vault.secrets where name in (
  'alerta_rotinas_token', 'lembrete_onboarding_token', 'reconciliacao_asaas_token'
);

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'alerta_rotinas_token',
  'Autentica o pg_cron na edge function alertar-rotinas.'
);

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'lembrete_onboarding_token',
  'Autentica o pg_cron na edge function lembrete-onboarding.'
);

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'reconciliacao_asaas_token',
  'Autentica o pg_cron na edge function asaas-reconciliar.'
);

-- ------------------------------------------------------------- Rotinas ------

-- As 12 do projeto atual. Horários em UTC, como o pg_cron os guarda.
select cron.unschedule(jobid) from cron.job;

select cron.schedule('arke-ativacao-pendente',      '0 * * * *',   'select public.gerar_tarefas_ativacao_pendente();');
select cron.schedule('arke-escalonamento-sla',      '0 * * * *',   'select public.escalar_tarefas_vencidas();');
select cron.schedule('arke-lancamentos-recorrentes','0 5 * * *',   'select public.gerar_lancamentos_recorrentes();');
select cron.schedule('arke-barreira-rotina',        '0 6 * * *',   'select public.gerar_tarefas_barreira_rotina();');
select cron.schedule('arke-lancamentos-atrasados',  '0 6 * * *',   'select public.marcar_lancamentos_atrasados();');
select cron.schedule('arke-acolhimento-elite',      '0 7 * * *',   'select public.gerar_tarefas_acolhimento_elite();');
select cron.schedule('arke-alerta-atestado',        '15 7 * * *',  'select public.gerar_tarefas_atestado();');
select cron.schedule('arke-engajamento-baixo',      '0 8 * * 1',   'select public.gerar_tarefas_engajamento_baixo();');
select cron.schedule('snapshot-mrr-diario',         '5 3 * * *',   'select public.capturar_snapshot_mrr();');

-- As três que chamam edge function: a URL abaixo é a do projeto de destino.
select cron.schedule(
  'arke-reconciliacao-asaas',
  '30 4 * * *',
  $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/asaas-reconciliar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reconciliacao-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'reconciliacao_asaas_token')
      ),
      body := '{"modo":"varredura"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cmd$
);

select cron.schedule(
  'arke-alerta-rotinas',
  '50 * * * *',
  $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/alertar-rotinas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$
);

select cron.schedule(
  'arke-lembrete-onboarding',
  '0 12 * * *',
  $cmd$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/lembrete-onboarding',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-lembrete-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'lembrete_onboarding_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$
);

-- Nenhuma rotina pode ter sobrado apontando para o projeto antigo.
select jobname, schedule, active
  from cron.job
 where command like '%jbkrxrfdrmrkyldrrdpq%';
