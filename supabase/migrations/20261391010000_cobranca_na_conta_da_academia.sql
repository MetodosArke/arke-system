-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Cobrança na conta da própria academia, por academia, desligada (06/10/2026).
--
-- Hoje toda cobrança do aluno sai da conta da ArkeFit no Asaas, com split de
-- valor fixo para a carteira da academia. Para a mensalidade e a avulsa (que
-- são da academia, e não da ArkeFit), isso põe a ArkeFit no meio do dinheiro
-- de outro, e é o ponto que o formato BaaS do Asaas não aceita: pela cláusula
-- obrigatória do art. 8º da Resolução Conjunta nº 16/2025, a tomadora não
-- cobra em nome próprio tarifa pelos serviços do prestador, nem recebe em
-- conta própria valores dos serviços prestados aos clientes.
--
-- O modo novo, ligado só pela ArkeFit e academia a academia:
--   * a mensalidade (`plano:`) e a avulsa (`avulsa:`) saem da conta Asaas da
--     academia, com a chave dela (a mesma do cofre que já emite a nota
--     fiscal), sem split e sem a taxa de processamento: o Asaas cobra a
--     tarifa direto da academia;
--   * o Método (`metodo:`) continua na conta da ArkeFit, com split para a
--     academia: é serviço da ArkeFit;
--   * receita, lançamentos, bloqueio e inadimplência não mudam, porque vêm de
--     `mensalidades` e `cobrancas_avulsas`.
--
-- O que este arquivo cria:
--   1. `organizations.cobranca_conta_academia`, que só muda por
--      `definir_cobranca_conta_academia()` (a edge function, com a ArkeFit
--      verificada em duas etapas), com auditoria;
--   2. `conta_asaas` em cada matrícula e cobrança avulsa: a conta onde a
--      assinatura ou a cobrança mora. É ela, e não o modo de hoje, que decide
--      onde cancelar, pausar, trocar o cartão e conferir — o modo vale para
--      cobrança nova. Não muda depois de criada (não se migra assinatura) e,
--      na conta da academia, não tem repasse;
--   3. `asaas_clientes_academia`: o id do cliente na conta da academia, que
--      mora separado do id na conta da ArkeFit;
--   4. `asaas_webhook_academia`: o hash do token do webhook que a função
--      registra na conta da academia. O token em claro só vai ao Asaas.

-- ── 1. O modo ────────────────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists cobranca_conta_academia boolean not null default false;

comment on column public.organizations.cobranca_conta_academia is
  'Mensalidade e cobrança avulsa saem da conta Asaas da própria academia, sem split e sem taxa da ArkeFit. O Método segue na conta da ArkeFit. Só muda por definir_cobranca_conta_academia().';

-- A coluna só muda pela função, nem pela ArkeFit direto pela API: ligar sem
-- registrar o webhook deixaria a academia cobrando sem ninguém ouvir o
-- pagamento. O corpo é o de 20261334010000, com a trava nova antes da saída
-- da ArkeFit.
create or replace function public.proteger_colunas_organizacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_arkefit boolean;
begin
  if v_uid is null then
    return new;
  end if;

  if new.cobranca_conta_academia is distinct from old.cobranca_conta_academia
     and coalesce(current_setting('arke.modo_cobranca', true), '') <> 'sim' then
    raise exception 'A cobrança na conta da academia é ligada e desligada pela ficha da organização na Visão Master, que registra o webhook na conta dela.' using errcode = '42501';
  end if;

  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if v_arkefit then
    return new;
  end if;

  if new.plano_b2b is distinct from old.plano_b2b
     or new.limite_alunos is distinct from old.limite_alunos
     or new.valor_mensal_b2b is distinct from old.valor_mensal_b2b
     or new.asaas_subscription_id_b2b is distinct from old.asaas_subscription_id_b2b
     or new.asaas_customer_id_b2b is distinct from old.asaas_customer_id_b2b
     or new.repasse_tipo is distinct from old.repasse_tipo
     or new.repasse_valor is distinct from old.repasse_valor
     or new.ficticia is distinct from old.ficticia then
    raise exception 'Plano, limite de alunos, mensalidade B2B, repasse do Método e a marca de academia fictícia são definidos pela ArkeFit.' using errcode = '42501';
  end if;

  if new.asaas_wallet_id is distinct from old.asaas_wallet_id
     or new.asaas_conta_id is distinct from old.asaas_conta_id
     or new.asaas_conta_origem is distinct from old.asaas_conta_origem
     or new.asaas_conta_status is distinct from old.asaas_conta_status then
    raise exception 'A conta Asaas da academia é configurada pelo onboarding (Recebimentos), que confere a carteira antes de gravar.' using errcode = '42501';
  end if;

  if new.onboarding_completed is distinct from old.onboarding_completed
     and coalesce(current_setting('arke.concluindo_onboarding', true), '') <> 'sim' then
    raise exception 'O onboarding é concluído pelo checklist, quando todas as etapas estiverem prontas.' using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ── 2. A conta de cada assinatura e de cada cobrança ─────────────────────────
alter table public.aluno_matriculas_academia
  add column if not exists conta_asaas text not null default 'arkefit';
alter table public.cobrancas_avulsas
  add column if not exists conta_asaas text not null default 'arkefit';

comment on column public.aluno_matriculas_academia.conta_asaas is
  'Conta Asaas onde a assinatura da mensalidade mora: arkefit (com split) ou academia (sem split, sem repasse). Decide onde cancelar, pausar, trocar o cartão e conferir. Não muda depois de criada.';
comment on column public.cobrancas_avulsas.conta_asaas is
  'Conta Asaas onde a cobrança mora: arkefit (com split) ou academia (sem split, sem repasse). Decide onde cancelar e conferir. Não muda depois de criada.';
comment on column public.aluno_matriculas_academia.asaas_customer_id is
  'Cliente na conta da ArkeFit. O cliente na conta da academia mora em asaas_clientes_academia.';

alter table public.aluno_matriculas_academia drop constraint if exists aluno_matriculas_academia_conta_asaas_check;
alter table public.aluno_matriculas_academia add constraint aluno_matriculas_academia_conta_asaas_check
  check (conta_asaas in ('arkefit', 'academia'));
-- Na conta da academia não há split: a ArkeFit não retém nada, e a academia
-- fica com o valor inteiro (a tarifa do Asaas é cobrada direto dela).
alter table public.aluno_matriculas_academia drop constraint if exists aluno_matriculas_academia_conta_sem_repasse;
alter table public.aluno_matriculas_academia add constraint aluno_matriculas_academia_conta_sem_repasse
  check (conta_asaas = 'arkefit' or (valor_repasse_arke = 0 and valor_liquido_academia = valor_cobrado));

alter table public.cobrancas_avulsas drop constraint if exists cobrancas_avulsas_conta_asaas_check;
alter table public.cobrancas_avulsas add constraint cobrancas_avulsas_conta_asaas_check
  check (conta_asaas in ('arkefit', 'academia'));
alter table public.cobrancas_avulsas drop constraint if exists cobrancas_avulsas_conta_sem_repasse;
alter table public.cobrancas_avulsas add constraint cobrancas_avulsas_conta_sem_repasse
  check (conta_asaas = 'arkefit' or (valor_repasse_arke = 0 and valor_liquido_academia = valor));

-- A conta não muda depois de criada, e só as funções (service_role) criam
-- cobrança na conta da academia: a equipe que grava uma matrícula à mão não
-- consegue mandar o cancelamento de uma assinatura para a conta errada.
create or replace function public.conta_asaas_fixa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.conta_asaas = 'academia' and auth.uid() is not null then
      raise exception 'Só a emissão pelo ARKE cria cobrança na conta Asaas da academia.' using errcode = '42501';
    end if;
  elsif new.conta_asaas is distinct from old.conta_asaas then
    raise exception 'A conta Asaas de uma cobrança não muda depois de criada: a assinatura e as cobranças moram nela. Para mudar, cancele e crie de novo.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_conta_asaas_fixa on public.aluno_matriculas_academia;
create trigger trg_conta_asaas_fixa
  before insert or update of conta_asaas on public.aluno_matriculas_academia
  for each row execute function public.conta_asaas_fixa();
drop trigger if exists trg_conta_asaas_fixa on public.cobrancas_avulsas;
create trigger trg_conta_asaas_fixa
  before insert or update of conta_asaas on public.cobrancas_avulsas
  for each row execute function public.conta_asaas_fixa();

-- ── 3. O cliente na conta da academia ────────────────────────────────────────
-- Na conta da ArkeFit o cliente é um por CPF, e serve às academias todas; na
-- conta da academia, é dela. Guardar os dois no mesmo lugar é o caminho mais
-- curto para mandar uma cobrança ao cliente da conta errada.
create table if not exists public.asaas_clientes_academia (
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Organização em trial fala com o sandbox: o cliente de lá não vale na produção.
  ambiente text not null check (ambiente in ('sandbox', 'producao')),
  asaas_customer_id text not null check (char_length(asaas_customer_id) between 1 and 100),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (aluno_id, ambiente)
);

comment on table public.asaas_clientes_academia is
  'O id do aluno como cliente na conta Asaas da própria academia (cobrança na conta da academia). Separado do cliente na conta da ArkeFit. Gravado pelas funções de cobrança.';

create index if not exists idx_asaas_clientes_academia_org on public.asaas_clientes_academia (organization_id);

alter table public.asaas_clientes_academia enable row level security;
revoke all on public.asaas_clientes_academia from anon, authenticated;
grant select on public.asaas_clientes_academia to authenticated;
grant all on public.asaas_clientes_academia to service_role;

-- Só a ArkeFit lê, para investigar; ninguém grava pela API.
drop policy if exists "leitura" on public.asaas_clientes_academia;
create policy "leitura" on public.asaas_clientes_academia
  for select to authenticated
  using (
    public.has_role((select auth.uid()), 'superadmin'::app_role)
    or public.has_role((select auth.uid()), 'admin_arke'::app_role)
  );

-- A regra das duas etapas, como em toda tabela com `aluno_id` (20261363010000).
drop policy if exists "duas etapas" on public.asaas_clientes_academia;
create policy "duas etapas" on public.asaas_clientes_academia as restrictive for all to authenticated
  using ((select public.sessao_cumpre_duas_etapas()))
  with check ((select public.sessao_cumpre_duas_etapas()));

-- ── 4. O webhook da conta da academia ────────────────────────────────────────
-- O hash do token, nunca o token: com o hash não se forja aviso. O token em
-- claro vai uma vez ao Asaas, no registro do webhook, e não volta.
create table if not exists public.asaas_webhook_academia (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  ambiente text not null check (ambiente in ('sandbox', 'producao')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  asaas_webhook_id text check (asaas_webhook_id is null or char_length(asaas_webhook_id) <= 100),
  registrado_em timestamptz not null default now(),
  registrado_por uuid
);

comment on table public.asaas_webhook_academia is
  'Webhook registrado pela ArkeFit na conta Asaas da academia (cobrança na conta da academia): o hash SHA-256 do token, que o asaas-webhook confere com ?org=. Fica depois de desligar o modo: estorno de cobrança antiga ainda chega por ele.';

alter table public.asaas_webhook_academia enable row level security;
-- Ninguém pela API: só a service_role (asaas-conta-academia grava, asaas-webhook lê).
revoke all on public.asaas_webhook_academia from anon, authenticated;
grant all on public.asaas_webhook_academia to service_role;

-- ── 5. Ligar e desligar ──────────────────────────────────────────────────────
-- Chamada só por `asaas-conta-academia` (acao "modo_cobranca"), com a
-- service_role, depois de conferir a ArkeFit em duas etapas e de registrar o
-- webhook na conta da academia. O modo, o hash e a auditoria gravam juntos.
--
-- Ligar é recusado com assinatura de plano viva na conta da ArkeFit para a
-- academia: não se migra assinatura, e duas contas cobrando o mesmo plano é o
-- aluno pagando duas vezes. Desligar é recusado com assinatura viva ou
-- cobrança avulsa em aberto na conta da academia, pelo mesmo motivo. A
-- mensagem diz quantas, e a quantidade vai em `detail`.
create or replace function public.definir_cobranca_conta_academia(
  _organization_id uuid,
  _ligar boolean,
  _ator_user_id uuid,
  _ambiente text,
  _token_hash text,
  _asaas_webhook_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_atual boolean;
  v_vivas integer;
  v_abertas integer;
begin
  select o.nome, o.cobranca_conta_academia into v_nome, v_atual
    from public.organizations o
   where o.id = _organization_id
   for update;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;

  if _ligar then
    select count(*) into v_vivas
      from public.aluno_matriculas_academia m
     where m.organization_id = _organization_id
       and m.conta_asaas = 'arkefit'
       and m.status in ('ativa', 'pausada')
       and m.asaas_subscription_id is not null;
    if v_vivas > 0 then
      raise exception using
        message = format('Há %s assinatura(s) de plano viva(s) na conta da ArkeFit para esta academia. O modo vale só para cobrança nova e não migra assinatura: cancele ou deixe terminar essas antes de ligar.', v_vivas),
        detail = v_vivas::text,
        errcode = 'P0001';
    end if;
    if _ambiente is null or _ambiente not in ('sandbox', 'producao') then
      raise exception 'Ambiente do Asaas inválido.' using errcode = '22023';
    end if;
    if _token_hash is null or _token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Hash do token do webhook inválido.' using errcode = '22023';
    end if;
    insert into public.asaas_webhook_academia as w
      (organization_id, ambiente, token_hash, asaas_webhook_id, registrado_em, registrado_por)
    values (_organization_id, _ambiente, _token_hash, _asaas_webhook_id, now(), _ator_user_id)
    on conflict (organization_id) do update
       set ambiente = excluded.ambiente,
           token_hash = excluded.token_hash,
           asaas_webhook_id = excluded.asaas_webhook_id,
           registrado_em = excluded.registrado_em,
           registrado_por = excluded.registrado_por;
  else
    select count(*) into v_vivas
      from public.aluno_matriculas_academia m
     where m.organization_id = _organization_id
       and m.conta_asaas = 'academia'
       and m.status in ('ativa', 'pausada')
       and m.asaas_subscription_id is not null;
    select count(*) into v_abertas
      from public.cobrancas_avulsas c
     where c.organization_id = _organization_id
       and c.conta_asaas = 'academia'
       and c.status in ('pendente', 'atrasado');
    if v_vivas + v_abertas > 0 then
      raise exception using
        message = format('Há %s assinatura(s) de plano viva(s) e %s cobrança(s) avulsa(s) em aberto na conta da academia. Elas seguem sendo cobradas e conferidas lá: cancele ou deixe terminar antes de desligar.', v_vivas, v_abertas),
        detail = (v_vivas + v_abertas)::text,
        errcode = 'P0001';
    end if;
    -- O webhook e o hash ficam: estorno e contestação de cobrança antiga,
    -- paga na conta da academia, ainda chegam por ele.
  end if;

  perform set_config('arke.modo_cobranca', 'sim', true);
  update public.organizations set cobranca_conta_academia = _ligar where id = _organization_id;
  perform set_config('arke.modo_cobranca', '', true);

  perform public.registrar_auditoria(
    _ator_user_id,
    case when _ligar then 'organizacao.cobranca_conta_academia_ligada' else 'organizacao.cobranca_conta_academia_desligada' end,
    'organizations',
    _organization_id,
    v_nome,
    jsonb_build_object('antes', v_atual, 'depois', _ligar, 'ambiente', _ambiente, 'webhook', _asaas_webhook_id)
  );

  return jsonb_build_object('ligado', _ligar, 'antes', v_atual);
end;
$$;

revoke execute on function public.definir_cobranca_conta_academia(uuid, boolean, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.definir_cobranca_conta_academia(uuid, boolean, uuid, text, text, text) to service_role;

-- ── 6. A situação, para a ficha da Visão Master e o Financeiro ───────────────
-- Recebe o id da academia, então confere quem chama: a ArkeFit (verificada,
-- pelo `has_role`) ou a gestão dela. Só contagens e datas, nenhum dado de aluno.
create or replace function public.situacao_cobranca_conta_academia(_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_uid uuid := auth.uid();
  v_ligado boolean;
  v_registrado timestamptz;
begin
  if not (
    public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')
    or exists (
      select 1 from public.organization_members m
       where m.organization_id = _organization_id and m.user_id = v_uid
         and m.status = 'active' and m.role = 'gestor'
    )
  ) then
    raise exception 'Sem permissão para ver a cobrança desta academia.' using errcode = '42501';
  end if;

  select o.cobranca_conta_academia into v_ligado from public.organizations o where o.id = _organization_id;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;
  select w.registrado_em into v_registrado from public.asaas_webhook_academia w where w.organization_id = _organization_id;

  return jsonb_build_object(
    'ligado', v_ligado,
    -- A chave da conta da academia no cofre (a mesma da nota fiscal): só se existe.
    'chave_conectada', exists (select 1 from vault.secrets s where s.name = 'asaas_subconta:' || _organization_id::text),
    'webhook_registrado_em', v_registrado,
    'plano_vivas_arkefit', (
      select count(*) from public.aluno_matriculas_academia m
       where m.organization_id = _organization_id and m.conta_asaas = 'arkefit'
         and m.status in ('ativa', 'pausada') and m.asaas_subscription_id is not null),
    'plano_vivas_academia', (
      select count(*) from public.aluno_matriculas_academia m
       where m.organization_id = _organization_id and m.conta_asaas = 'academia'
         and m.status in ('ativa', 'pausada') and m.asaas_subscription_id is not null),
    'avulsas_abertas_academia', (
      select count(*) from public.cobrancas_avulsas c
       where c.organization_id = _organization_id and c.conta_asaas = 'academia'
         and c.status in ('pendente', 'atrasado'))
  );
end;
$$;

revoke execute on function public.situacao_cobranca_conta_academia(uuid) from public, anon;
grant execute on function public.situacao_cobranca_conta_academia(uuid) to authenticated, service_role;

-- Funções de gatilho nascem com EXECUTE para o PUBLIC, e `create or replace`
-- devolve: revoga as desta rodada.
revoke execute on function public.conta_asaas_fixa() from public, anon, authenticated;
revoke execute on function public.proteger_colunas_organizacao() from public, anon, authenticated;
