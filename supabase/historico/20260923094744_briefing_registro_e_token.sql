-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Registro dos briefings enviados + token do cron.
--
-- O registro serve a duas coisas: idempotencia (uma academia nao recebe dois
-- briefings na mesma semana, nem se a rotina rodar duas vezes) e prova do que
-- foi dito — a mensagem vai assinada pela ArkeFit, entao precisa haver como
-- reconstituir depois qual numero foi enviado em qual semana.
create table if not exists public.briefings_enviados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Segunda-feira da semana a que o briefing se refere.
  semana date not null,
  canal text not null default 'whatsapp',
  destino text,
  enviado_em timestamptz,
  erro text,
  -- Os numeros exatos que foram enviados, para o "mas o sistema me disse X".
  numeros jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, semana)
);

alter table public.briefings_enviados enable row level security;

-- So a ArkeFit le: e registro de operacao da celula, nao da academia.
drop policy if exists "leitura" on public.briefings_enviados;
create policy "leitura" on public.briefings_enviados
  for select to authenticated
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

grant select on public.briefings_enviados to authenticated;
grant all on public.briefings_enviados to service_role;

create index if not exists idx_briefings_enviados_semana
  on public.briefings_enviados (semana desc);

-- Token proprio para o cron chamar a edge function, no mesmo desenho do alerta
-- de rotinas: nasce no banco, mora no Vault e nao aparece escrito no comando.
do $$
declare _t text;
begin
  if not exists (select 1 from vault.secrets where name = 'briefing_semanal_token') then
    _t := encode(gen_random_bytes(32), 'hex');
    perform vault.create_secret(_t, 'briefing_semanal_token', 'Token do cron do briefing semanal');
  end if;
end $$;

create or replace function public.conferir_token_briefing(_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'vault'
as $$
  select exists (
    select 1 from vault.decrypted_secrets
     where name = 'briefing_semanal_token' and decrypted_secret = _token
  );
$$;

revoke execute on function public.conferir_token_briefing(text) from public;
grant execute on function public.conferir_token_briefing(text) to service_role;

-- Quais academias devem receber nesta segunda: as ativas e liberadas que ainda
-- nao receberam o briefing desta semana.
create or replace function public.organizacoes_para_briefing()
returns table(organization_id uuid, semana date)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id, date_trunc('week', current_date::timestamp)::date
    from public.organizations o
   where o.status in ('ativo', 'trial')
     and (o.onboarding_completed or o.status = 'trial')
     and not exists (
       select 1 from public.briefings_enviados b
        where b.organization_id = o.id
          and b.semana = date_trunc('week', current_date::timestamp)::date
          and b.enviado_em is not null
     );
$$;

revoke execute on function public.organizacoes_para_briefing() from public;
grant execute on function public.organizacoes_para_briefing() to service_role;
