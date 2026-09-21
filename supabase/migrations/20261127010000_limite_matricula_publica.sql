-- Anti-abuso da matrícula pública.
--
-- `matricula-publica` é endpoint público (verify_jwt = false) que cria usuário
-- no Auth e linhas em profiles, organization_members e alunos. Até aqui o
-- único freio era não saberem o slug. No dia em que a academia divulgar o
-- link, um script cria mil contas na conta dela — e cada uma conta contra o
-- `limite_alunos` do plano, ou seja, o ataque também tranca a matrícula de
-- quem é aluno de verdade.
--
-- ## Os números, e por que são folgados por IP
--
-- A armadilha óbvia de limitar por IP: alunos se matriculando no Wi-Fi da
-- academia saem todos pelo **mesmo IP**. O dia de lançamento de uma academia —
-- recepção cheia, QR code na parede — é exatamente o cenário em que um limite
-- apertado por IP bloquearia gente de verdade. Então:
--
--   - por IP, **30 tentativas em 15 minutos**: contém o script que martela o
--     endpoint, sem incomodar uma fila de recepção;
--   - por IP, **20 matrículas concluídas por hora**: uma turma inteira passa,
--     uma fábrica de contas não;
--   - por organização, **60 matrículas concluídas por hora**: o teto de volume
--     que independe de quantos IPs o atacante tiver.
--
-- ## Privacidade
--
-- IP é dado pessoal. O que se guarda é o **hash** do IP com uma pimenta que só
-- a edge function conhece, nunca o endereço, e as linhas são apagadas depois
-- de 24 h — a maior janela de contagem é de 1 h, então não há razão para
-- guardar mais.
--
-- ## Multitenancy (regra 1 do projeto)
--
-- A tabela tem `organization_id`, preenchido quando a matrícula conclui. Fica
-- nulo na tentativa que não passou da validação — nesse ponto não se sabe de
-- qual academia ela seria, e muitas vezes o slug nem existe. RLS fica ligado
-- sem nenhuma policy: nenhum cliente lê nem escreve aqui, só a edge function
-- com service_role, pelas três funções abaixo.

create table if not exists public.matricula_publica_tentativas (
  id              bigserial primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  ip_hash         text not null,
  concluida       boolean not null default false,
  created_at      timestamptz not null default now()
);

comment on table public.matricula_publica_tentativas is
  'Contagem de tentativas da matrícula pública para limite de taxa. Guarda hash '
  'do IP, nunca o endereço; linhas com mais de 24 h são apagadas.';

alter table public.matricula_publica_tentativas enable row level security;
revoke all on public.matricula_publica_tentativas from anon, authenticated;

create index if not exists matricula_publica_tentativas_ip_idx
  on public.matricula_publica_tentativas (ip_hash, created_at);

create index if not exists matricula_publica_tentativas_org_idx
  on public.matricula_publica_tentativas (organization_id, created_at)
  where concluida;

-- 1) Porta de entrada: conta a tentativa por IP e devolve o id dela, ou nulo
--    quando o IP estourou um dos dois limites.
create or replace function public.registrar_tentativa_matricula(_ip_hash text)
returns bigint
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_tentativas int;
  v_concluidas int;
  v_id bigint;
begin
  -- Serializa as tentativas do mesmo IP: sem isto, uma rajada simultânea
  -- leria a mesma contagem em todas as requisições e passaria inteira.
  perform pg_advisory_xact_lock(hashtext('matricula_publica:' || _ip_hash));

  -- Faxina oportunista: a maior janela é de 1 h, e 24 h de folga bastam para
  -- investigar um ataque. Sem cron novo só para isto.
  delete from public.matricula_publica_tentativas
   where created_at < now() - interval '24 hours';

  select count(*) into v_tentativas
    from public.matricula_publica_tentativas
   where ip_hash = _ip_hash and created_at > now() - interval '15 minutes';

  select count(*) into v_concluidas
    from public.matricula_publica_tentativas
   where ip_hash = _ip_hash and concluida and created_at > now() - interval '1 hour';

  if v_tentativas >= 30 or v_concluidas >= 20 then
    return null;
  end if;

  insert into public.matricula_publica_tentativas (ip_hash)
  values (_ip_hash)
  returning id into v_id;

  return v_id;
end;
$$;

-- 2) Teto por organização, consultado depois que o slug virou organização.
create or replace function public.matricula_publica_org_permitida(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*) < 60
    from public.matricula_publica_tentativas
   where organization_id = _organization_id
     and concluida
     and created_at > now() - interval '1 hour';
$$;

-- 3) Marca a tentativa como matrícula concluída, com a academia.
create or replace function public.concluir_tentativa_matricula(_id bigint, _organization_id uuid)
returns void
language sql
volatile
security definer
set search_path to 'public'
as $$
  update public.matricula_publica_tentativas
     set concluida = true, organization_id = _organization_id
   where id = _id;
$$;

-- Só a edge function (service_role) chama. Deixar alcançável por anon seria
-- dar ao atacante um jeito de encher a tabela ou sondar os limites.
revoke execute on function public.registrar_tentativa_matricula(text) from public, anon, authenticated;
revoke execute on function public.matricula_publica_org_permitida(uuid) from public, anon, authenticated;
revoke execute on function public.concluir_tentativa_matricula(bigint, uuid) from public, anon, authenticated;
grant execute on function public.registrar_tentativa_matricula(text) to service_role;
grant execute on function public.matricula_publica_org_permitida(uuid) to service_role;
grant execute on function public.concluir_tentativa_matricula(bigint, uuid) to service_role;
