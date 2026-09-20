-- Progressão da jornada: a equipe move o aluno de fase, manualmente, na ficha.
--
-- Até aqui existia uma única transição — um trigger levava de M.A.P.A.® para
-- B.A.S.E.® ao publicar a primeira prescrição — e nenhum caminho para
-- R.O.T.A.®, A.P.E.X.® ou L.E.G.A.D.O.®. Três das cinco fases eram
-- inalcançáveis, e os contadores por fase nos painéis ficavam zerados para
-- sempre. A decisão foi dar o controle à equipe, não automatizar.
--
-- O movimento fica registrado: sem isso, "a equipe move" viraria uma mudança
-- sem autor nem data, e a fase é o que orienta o atendimento.

create table if not exists public.aluno_fase_historico (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  fase_anterior   public.fase_jornada,
  fase_nova       public.fase_jornada not null,
  movido_por      uuid,
  -- Desnormalizado de propósito: quem moveu pode sair da equipe depois, e o
  -- histórico precisa continuar legível.
  movido_por_nome text,
  observacao      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_aluno_fase_historico_aluno
  on public.aluno_fase_historico (aluno_id, created_at desc);

alter table public.aluno_fase_historico enable row level security;

create policy "staff da org vê o histórico de fases dos seus alunos"
  on public.aluno_fase_historico for select to authenticated
  using (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  );

-- Escrita só pela função abaixo (security definer). Sem policy de INSERT, o
-- RLS nega por padrão a qualquer cliente.

-- ---------------------------------------------------------------------
-- Mover de fase
-- ---------------------------------------------------------------------
create or replace function public.mover_fase_jornada(
  _aluno_id uuid,
  _fase public.fase_jornada,
  _observacao text default null
)
returns public.fase_jornada
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_atual public.fase_jornada;
  v_nome text;
begin
  select a.organization_id, a.fase_jornada into v_org, v_atual
    from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not (public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')
          or public.is_org_staff(auth.uid(), v_org)) then
    raise exception 'Apenas a equipe da academia ou a ArkeFit podem mover a fase da jornada.';
  end if;

  -- Mover para a fase em que o aluno já está não é erro, mas também não
  -- vira linha no histórico: registraria um movimento que não houve.
  if v_atual = _fase then
    return v_atual;
  end if;

  select p.full_name into v_nome from public.profiles p where p.user_id = auth.uid();

  update public.alunos set fase_jornada = _fase where id = _aluno_id;

  insert into public.aluno_fase_historico
    (organization_id, aluno_id, fase_anterior, fase_nova, movido_por, movido_por_nome, observacao)
  values
    (v_org, _aluno_id, v_atual, _fase, auth.uid(), v_nome, nullif(btrim(_observacao), ''));

  return _fase;
end;
$$;

comment on function public.mover_fase_jornada(uuid, public.fase_jornada, text) is
  'Move o aluno de fase da jornada por decisão da equipe, registrando autor, data e observação em aluno_fase_historico.';

revoke all on function public.mover_fase_jornada(uuid, public.fase_jornada, text) from public, anon;
grant execute on function public.mover_fase_jornada(uuid, public.fase_jornada, text) to authenticated;

-- ---------------------------------------------------------------------
-- A transição automática M.A.P.A.® -> B.A.S.E.® passa a respeitar o acolhimento
-- ---------------------------------------------------------------------
-- O trigger existente avançava a fase ao publicar a primeira prescrição, sem
-- olhar se a anamnese tinha sido concluída — daí haver aluno marcado como
-- tendo passado pelo M.A.P.A.® sem ter passado. Com a equipe no controle, a
-- automação continua útil como atalho do primeiro passo, mas só quando o
-- acolhimento de fato aconteceu. Nos demais casos a fase espera a equipe.
create or replace function public.avancar_fase_apos_publicacao()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.alunos a
     set fase_jornada = 'base'
   where a.id = new.aluno_id
     and a.fase_jornada = 'mapa'
     and exists (
       select 1 from public.anamnese_acolhimento an
        where an.aluno_id = a.id and an.concluida_em is not null
     );
  return new;
end;
$$;
