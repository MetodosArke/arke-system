-- Registros de acesso à aplicação, por 6 meses (Marco Civil da Internet, art. 15).
--
-- Auditoria de prontidão de 05/10/2026, achado a conferir fora do código. A
-- ArkeFit é provedor de aplicação de internet constituído como pessoa
-- jurídica, com fins econômicos: o art. 15 do Marco Civil (Lei 12.965/2014)
-- manda guardar os registros de acesso à aplicação (data e hora de uso a
-- partir de um IP) por 6 meses, sob sigilo, em ambiente controlado e seguro,
-- e entregá-los só com ordem judicial.
--
-- O que havia não cumpria: `auth.audit_log_entries` está vazia (o Supabase
-- guarda a auditoria do login só nos logs da plataforma, por poucos dias), e
-- `auth.sessions` tem o IP, mas a sessão some quando a pessoa sai ou ela vence.
--
-- Desenho:
-- - Uma linha por pessoa, IP e dia, com a primeira e a última hora vistas. O
--   gatilho em `auth.sessions` anota quando a sessão nasce (a entrada) e
--   quando ela é renovada (o uso, a cada renovação do token). Uma linha por
--   dia, e não por renovação: o mínimo que responde "quem usou, de onde e
--   quando", sem virar um rastro de cada hora.
-- - Ninguém lê pela API: RLS sem regra e sem permissão para anon e
--   authenticated. A leitura é só da ArkeFit, por SQL, diante de ordem judicial
--   (docs/registro/seguranca-e-acesso.md).
-- - Passados 6 meses, a linha sai (rotina diária). Guardar mais seria contra a
--   LGPD, que manda eliminar o que não tem mais finalidade.
-- - É tabela da plataforma, sem organização: o registro é da pessoa na
--   aplicação, e não do atendimento de uma academia. Exceção declarada, como
--   `plataforma_config`.
-- - O login nunca falha por causa disto: o gatilho engole o próprio erro.

set lock_timeout = '5s';

create table if not exists public.registros_acesso_aplicacao (
  user_id uuid not null,
  ip inet not null,
  dia date not null,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  primary key (user_id, ip, dia)
);

create index if not exists idx_registros_acesso_aplicacao_dia on public.registros_acesso_aplicacao (dia);

comment on table public.registros_acesso_aplicacao is
  'Registros de acesso a aplicacao (Marco Civil, art. 15): pessoa, IP e dia, por 6 meses, sob sigilo. Leitura so da ArkeFit, por SQL, com ordem judicial.';

alter table public.registros_acesso_aplicacao enable row level security;
revoke all on public.registros_acesso_aplicacao from anon, authenticated;

create or replace function public.registrar_acesso_aplicacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ip is null or new.user_id is null then
    return null;
  end if;
  insert into public.registros_acesso_aplicacao (user_id, ip, dia)
  values (new.user_id, new.ip, current_date)
  on conflict (user_id, ip, dia) do update set ultimo_em = now();
  return null;
exception when others then
  -- Um registro que falha não pode derrubar a entrada de ninguém.
  return null;
end;
$$;

drop trigger if exists trg_registrar_acesso_aplicacao on auth.sessions;
create trigger trg_registrar_acesso_aplicacao
  after insert or update of ip, refreshed_at on auth.sessions
  for each row execute function public.registrar_acesso_aplicacao();

revoke execute on function public.registrar_acesso_aplicacao() from public, anon, authenticated;

-- Os 6 meses: guarda o prazo inteiro e apaga o que passou dele.
create or replace function public.limpar_registros_acesso_aplicacao()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.registros_acesso_aplicacao where dia < (current_date - interval '6 months')::date;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.limpar_registros_acesso_aplicacao() from public, anon, authenticated;
grant execute on function public.limpar_registros_acesso_aplicacao() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'arke-registros-de-acesso';
select cron.schedule('arke-registros-de-acesso', '10 7 * * *', 'select public.limpar_registros_acesso_aplicacao()');
