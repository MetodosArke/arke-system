-- O cliente do aluno no Asaas, anonimizado na saída, sem travar a saída
-- (auditoria de prontidão, 06/10/2026).
--
-- A anonimização e a exclusão do aluno passam a anonimizar o cadastro dele no
-- Asaas (`_shared/clienteAsaas.ts`, ligado em `anonimizar-aluno` e
-- `excluir-aluno` por `_shared/saidaAsaas.ts`). A regra de falha é a de
-- sempre na saída: o direito da pessoa não espera o gateway. Se o Asaas não
-- responde, a saída segue, e fica aqui a pendência; a rotina
-- `arke-saida-asaas` (`retentar-saida-asaas`, de hora em hora) tenta de novo
-- até dar certo, e a linha sai quando dá.
--
-- A pendência não guarda CPF, nome nem e-mail: a nova tentativa procura o
-- cliente pela referência com que ele foi criado (o id de cada matrícula da
-- pessoa), e o resto já foi apagado pela anonimização. Guarda se a pessoa
-- tinha outro vínculo vivo na hora da saída, porque é isso que decide o que
-- se pode tocar no Asaas, e depois da exclusão o banco não sabe mais.

set lock_timeout = '5s';

create table if not exists public.asaas_saida_pendente (
  aluno_id uuid primary key,
  organization_id uuid not null,
  user_id uuid,
  outros_vinculos boolean not null,
  tentativas integer not null default 1,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.asaas_saida_pendente is
  'Aluno que saiu (anonimizado ou excluído) e cujo cliente no Asaas ainda não foi anonimizado. A rotina arke-saida-asaas tenta de novo; a linha sai quando dá certo. Sem dado pessoal.';

create index if not exists idx_asaas_saida_pendente_fila on public.asaas_saida_pendente (atualizado_em);

alter table public.asaas_saida_pendente enable row level security;
revoke all on public.asaas_saida_pendente from anon, authenticated;
grant select on public.asaas_saida_pendente to authenticated;
grant all on public.asaas_saida_pendente to service_role;

-- Só a Visão Master lê (para ver o que está pendente); ninguém grava pela API.
drop policy if exists "leitura" on public.asaas_saida_pendente;
create policy "leitura" on public.asaas_saida_pendente
  for select to authenticated
  using (public.has_role((select auth.uid()), 'superadmin'::app_role));

-- A regra das duas etapas, como em toda tabela com `aluno_id` (20261363010000).
drop policy if exists "duas etapas" on public.asaas_saida_pendente;
create policy "duas etapas" on public.asaas_saida_pendente as restrictive for all to authenticated
  using ((select public.sessao_cumpre_duas_etapas()))
  with check ((select public.sessao_cumpre_duas_etapas()));

-- Guarda (ou atualiza) a pendência, contando a tentativa.
create or replace function public.registrar_saida_asaas_pendente(
  _aluno_id uuid,
  _organization_id uuid,
  _user_id uuid,
  _outros_vinculos boolean,
  _erro text
)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.asaas_saida_pendente as p (aluno_id, organization_id, user_id, outros_vinculos, ultimo_erro)
  values (_aluno_id, _organization_id, _user_id, _outros_vinculos, left(_erro, 500))
  on conflict (aluno_id) do update
     set tentativas = p.tentativas + 1,
         ultimo_erro = left(_erro, 500),
         atualizado_em = now();
$$;

revoke execute on function public.registrar_saida_asaas_pendente(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.registrar_saida_asaas_pendente(uuid, uuid, uuid, boolean, text) to service_role;

-- O alerta de rotinas passa a esperar o desfecho da função (20261248010000).
insert into public.execucoes_agendadas (nome, ultima_ok) values ('retentar-saida-asaas', now())
on conflict (nome) do nothing;

-- De hora em hora, aos 25 minutos, com o token do alerta de rotinas.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-saida-asaas';
select cron.schedule(
  'arke-saida-asaas',
  '25 * * * *',
  $cron$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/retentar-saida-asaas',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token', (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);
