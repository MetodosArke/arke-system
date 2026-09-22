-- Lembrete diário de onboarding parado (edge function lembrete-onboarding).
-- Mesmo desenho do alerta de rotinas: token gerado pelo banco no Vault, sem
-- segredo novo para configurar, e o cron o lê na hora de chamar.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'lembrete_onboarding_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'lembrete_onboarding_token',
      'Autentica o pg_cron na edge function lembrete-onboarding.'
    );
  end if;
end $$;

create or replace function public.conferir_token_lembrete_onboarding(_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'lembrete_onboarding_token' and decrypted_secret = _token
  );
$$;

revoke execute on function public.conferir_token_lembrete_onboarding(text) from public, anon, authenticated;
grant execute on function public.conferir_token_lembrete_onboarding(text) to service_role;

create or replace function public.registrar_lembrete_onboarding(_organization_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.organizations
     set onboarding_lembrete_em = now(), onboarding_lembretes = onboarding_lembretes + 1
   where id = _organization_id;
$$;

revoke execute on function public.registrar_lembrete_onboarding(uuid) from public, anon, authenticated;
grant execute on function public.registrar_lembrete_onboarding(uuid) to service_role;

-- 12:00 UTC = 9h em Brasília: chega no começo do expediente da academia.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-lembrete-onboarding';
select cron.schedule(
  'arke-lembrete-onboarding',
  '0 12 * * *',
  $cmd$
    select net.http_post(
      url := 'https://jbkrxrfdrmrkyldrrdpq.supabase.co/functions/v1/lembrete-onboarding',
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
