-- Etapa 3 da frente de operação nativa da academia: comissão de staff
-- sobre venda (matrícula em plano da academia) ou adesão (Método ARKE).
-- Regra simples por papel (não por profissional individual — evita
-- superengenhar antes de saber se a academia precisa de granularidade
-- maior), configurável pelo gestor. Lançamento gerado automaticamente
-- por trigger, idempotente via origem_evento (mesmo padrão do motor de
-- automações), então nunca duplica mesmo que o evento dispare mais de
-- uma vez.

create type public.comissao_tipo_evento as enum ('matricula_academia', 'adesao_metodo_arke');
create type public.comissao_status as enum ('pendente', 'pago');

-- Precisamos saber QUEM registrou a matrícula/adesão pra saber de quem
-- é a comissão. aluno_matriculas_academia.registrado_por já existe
-- (Etapa 1) mas nunca foi preenchida — a edge function passa a setá-la
-- a partir daqui. Pro lado da adesão ao Método ARKE, a coluna ainda
-- não existia.
alter table public.alunos
  add column metodo_arke_ativado_por uuid references auth.users(id) on delete set null;

create table public.staff_comissoes_config (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  papel           public.app_role not null,
  tipo_evento     public.comissao_tipo_evento not null,
  percentual      numeric(5,2) check (percentual is null or (percentual >= 0 and percentual <= 100)),
  valor_fixo      numeric(10,2) check (valor_fixo is null or valor_fixo >= 0),
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, papel, tipo_evento)
);

create index idx_staff_comissoes_config_organization_id on public.staff_comissoes_config(organization_id);

create table public.staff_comissoes_lancamentos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  tipo_evento     public.comissao_tipo_evento not null,
  aluno_id        uuid references public.alunos(id) on delete set null,
  origem_evento   text not null, -- idempotência: 'matricula_academia:<matricula_id>' / 'adesao_metodo_arke:<aluno_id>'
  valor_base      numeric(10,2) not null,
  valor_comissao  numeric(10,2) not null,
  status          public.comissao_status not null default 'pendente',
  competencia     date not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, origem_evento)
);

create index idx_staff_comissoes_lancamentos_organization_id on public.staff_comissoes_lancamentos(organization_id);
create index idx_staff_comissoes_lancamentos_user_id on public.staff_comissoes_lancamentos(user_id);
create index idx_staff_comissoes_lancamentos_aluno_id on public.staff_comissoes_lancamentos(aluno_id);

create trigger trg_staff_comissoes_config_updated_at
  before update on public.staff_comissoes_config
  for each row execute function public.set_updated_at();

create trigger trg_staff_comissoes_lancamentos_updated_at
  before update on public.staff_comissoes_lancamentos
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------
alter table public.staff_comissoes_config enable row level security;
alter table public.staff_comissoes_lancamentos enable row level security;

create policy "gestor gerencia config de comissão"
  on public.staff_comissoes_config for all
  to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'));

create policy "gestor gerencia lançamentos de comissão"
  on public.staff_comissoes_lancamentos for all
  to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'));

create policy "profissional vê as próprias comissões"
  on public.staff_comissoes_lancamentos for select
  to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------
-- Geração automática do lançamento: olha o papel de quem registrou o
-- evento na organização, busca a regra configurada (se houver e
-- estiver ativa) e cria o lançamento. Sem regra configurada ou regra
-- que resulta em comissão zero, não gera nada.
-- -----------------------------------------------------------------
create or replace function public.gerar_comissao_se_configurada(
  _organization_id uuid,
  _user_id uuid,
  _tipo_evento public.comissao_tipo_evento,
  _aluno_id uuid,
  _origem_evento text,
  _valor_base numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_papel public.app_role;
  v_config record;
  v_valor_comissao numeric;
begin
  select role into v_papel
    from public.organization_members
    where user_id = _user_id and organization_id = _organization_id and status = 'active'
    limit 1;
  if v_papel is null then
    return;
  end if;

  select * into v_config
    from public.staff_comissoes_config
    where organization_id = _organization_id and papel = v_papel and tipo_evento = _tipo_evento and ativo;
  if not found then
    return;
  end if;

  v_valor_comissao := coalesce(_valor_base * (v_config.percentual / 100), 0) + coalesce(v_config.valor_fixo, 0);
  if v_valor_comissao <= 0 then
    return;
  end if;

  insert into public.staff_comissoes_lancamentos
    (organization_id, user_id, tipo_evento, aluno_id, origem_evento, valor_base, valor_comissao, competencia)
  values
    (_organization_id, _user_id, _tipo_evento, _aluno_id, _origem_evento, _valor_base, v_valor_comissao, date_trunc('month', now())::date)
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

revoke execute on function public.gerar_comissao_se_configurada(uuid, uuid, public.comissao_tipo_evento, uuid, text, numeric) from public;

create or replace function public.trg_comissao_matricula_academia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.registrado_por is not null then
    perform public.gerar_comissao_se_configurada(
      new.organization_id,
      new.registrado_por,
      'matricula_academia',
      new.aluno_id,
      'matricula_academia:' || new.id::text,
      new.valor_cobrado
    );
  end if;
  return new;
end;
$$;

create trigger trg_comissao_matricula
  after insert on public.aluno_matriculas_academia
  for each row execute function public.trg_comissao_matricula_academia();

create or replace function public.trg_comissao_adesao_metodo_arke()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valor numeric;
begin
  if new.metodo_arke_status = 'ativo'
     and old.metodo_arke_status is distinct from 'ativo'
     and new.metodo_arke_ativado_por is not null then
    select valor_cobrado into v_valor
      from public.aluno_assinaturas
      where aluno_id = new.id
      order by created_at desc
      limit 1;

    perform public.gerar_comissao_se_configurada(
      new.organization_id,
      new.metodo_arke_ativado_por,
      'adesao_metodo_arke',
      new.id,
      'adesao_metodo_arke:' || new.id::text,
      coalesce(v_valor, 0)
    );
  end if;
  return new;
end;
$$;

create trigger trg_comissao_adesao
  after update on public.alunos
  for each row execute function public.trg_comissao_adesao_metodo_arke();
