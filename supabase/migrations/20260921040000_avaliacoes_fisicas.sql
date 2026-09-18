-- Módulo de Avaliação Física completa (antropometria, dobras cutâneas,
-- perimetria, dores e histórico), lançada pelo Personal/equipe da
-- academia e visível no histórico do próprio aluno. Segue o mesmo
-- protocolo de 7 dobras cutâneas (Pollock) usado nos formulários de
-- avaliação física do mercado fitness.
create table public.avaliacoes_fisicas (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  aluno_id          uuid not null references public.alunos(id) on delete cascade,
  avaliado_por      uuid references auth.users(id) on delete set null,
  data_avaliacao    date not null default current_date,

  -- Antropometria básica
  peso_kg           numeric(5,2),
  altura_cm         numeric(5,2),
  imc               numeric(5,2) generated always as (
                      case when altura_cm > 0 then round((peso_kg / ((altura_cm / 100.0) ^ 2))::numeric, 2) else null end
                    ) stored,
  percentual_gordura numeric(5,2),

  -- Dobras cutâneas (mm) — protocolo de 7 dobras
  dc_triceps        numeric(5,2),
  dc_subescapular   numeric(5,2),
  dc_suprailiaca    numeric(5,2),
  dc_abdominal      numeric(5,2),
  dc_coxa           numeric(5,2),
  dc_peitoral       numeric(5,2),
  dc_axilar_media   numeric(5,2),

  -- Perimetria (cm)
  perim_braco       numeric(5,2),
  perim_antebraco   numeric(5,2),
  perim_cintura     numeric(5,2),
  perim_abdomen     numeric(5,2),
  perim_quadril     numeric(5,2),
  perim_coxa        numeric(5,2),
  perim_panturrilha numeric(5,2),

  dores_relatadas   text,
  historico_clinico text,
  observacoes       text,

  created_at        timestamptz not null default now()
);

create index idx_avaliacoes_fisicas_aluno on public.avaliacoes_fisicas(aluno_id, data_avaliacao desc);
create index idx_avaliacoes_fisicas_org on public.avaliacoes_fisicas(organization_id);

alter table public.avaliacoes_fisicas enable row level security;

create policy "staff da org gerencia avaliações físicas dos seus alunos"
  on public.avaliacoes_fisicas for all
  to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id))
  with check (public.is_org_staff((select auth.uid()), organization_id));

create policy "aluno vê as próprias avaliações físicas"
  on public.avaliacoes_fisicas for select
  to authenticated
  using (
    aluno_id in (
      select a.id from public.alunos a where a.user_id = (select auth.uid())
    )
  );
