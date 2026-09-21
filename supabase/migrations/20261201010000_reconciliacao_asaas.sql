-- Reconciliação Asaas ↔ banco.
--
-- Todo o estado financeiro do banco chega por webhook. A rede de segurança de
-- inadimplência (aluno_inadimplente_b2c, organizacao_inadimplente_b2b) fecha
-- um lado do webhook perdido — o PAYMENT_OVERDUE que não chegou deixava o
-- acesso liberado para sempre. Mas ela abre o lado oposto: se o que se perde é
-- o PAYMENT_CONFIRMED, a cobrança fica "vencida e não confirmada" no banco, e
-- **quem pagou é bloqueado**. Só perguntar ao Asaas resolve.
--
-- A edge function `asaas-reconciliar` faz isso e, quando o Asaas e o banco
-- divergem, reenvia o evento correspondente ao próprio `asaas-webhook`. O
-- efeito no banco sai do mesmo código de sempre — não há segunda
-- implementação de "o que fazer quando confirma" para divergir da primeira —,
-- e cada correção aparece no painel de webhooks com o prefixo `reconciliacao:`.
--
-- Dois modos: varredura diária pelo pg_cron, e sob demanda pelo próprio aluno
-- no botão "Já paguei, verificar novamente" da tela de bloqueio.

create extension if not exists pg_net;

-- Token que autentica o pg_cron na edge function. Gerado aqui e guardado no
-- Vault: não há segredo novo para configurar à mão, e ele não aparece escrito
-- no comando do cron (que qualquer um com acesso a cron.job leria).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'reconciliacao_asaas_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'reconciliacao_asaas_token',
      'Autentica o pg_cron na edge function asaas-reconciliar.'
    );
  end if;
end $$;

create or replace function public.conferir_token_reconciliacao(_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'reconciliacao_asaas_token' and decrypted_secret = _token
  );
$$;

revoke execute on function public.conferir_token_reconciliacao(text) from public, anon, authenticated;
grant execute on function public.conferir_token_reconciliacao(text) to service_role;

-- Registro de cada varredura, para a Visão Master.
--
-- Sem organization_id de propósito, na mesma linha de asaas_webhook_events:
-- uma varredura atravessa todas as academias e é da operação da ArkeFit, não
-- de um tenant. RLS ligado; só a ArkeFit lê, e só a service_role escreve.
create table if not exists public.reconciliacoes_asaas (
  id              bigserial primary key,
  executada_em    timestamptz not null default now(),
  modo            text not null check (modo in ('varredura', 'aluno')),
  cobrancas_verificadas integer not null default 0,
  divergencias    integer not null default 0,
  corrigidas      integer not null default 0,
  assinaturas_orfas integer not null default 0,
  detalhes        jsonb not null default '[]'::jsonb,
  erro            text
);

comment on table public.reconciliacoes_asaas is
  'Cada execução da reconciliação Asaas ↔ banco. Nível de plataforma (sem organization_id), como asaas_webhook_events.';

alter table public.reconciliacoes_asaas enable row level security;
revoke all on public.reconciliacoes_asaas from anon, authenticated;
grant select on public.reconciliacoes_asaas to authenticated;

drop policy if exists "ArkeFit lê as reconciliações" on public.reconciliacoes_asaas;
create policy "ArkeFit lê as reconciliações"
  on public.reconciliacoes_asaas for select to authenticated
  using (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke'));

create index if not exists idx_reconciliacoes_asaas_executada_em on public.reconciliacoes_asaas (executada_em desc);

-- Freio do modo "aluno": o botão pode ser clicado em sequência, e cada clique
-- consulta o Asaas. Uma verificação por aluno a cada 30 s basta.
alter table public.aluno_assinaturas add column if not exists reconciliada_em timestamptz;

-- Varredura diária. Às 04:30 UTC (01:30 em Brasília): antes das rotinas que
-- abrem tarefa pela manhã, para elas já enxergarem o banco corrigido.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-reconciliacao-asaas';
select cron.schedule(
  'arke-reconciliacao-asaas',
  '30 4 * * *',
  $cmd$
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
  $cmd$
);
