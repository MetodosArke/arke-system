-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Fase 5b: sugestao de resposta no chat do Mentor (23/09/2026).
--
-- A tabela existe para uma pergunta so, e ela decide o futuro do recurso:
-- **o mentor usa a sugestao?** Se aceitar 10%, o Sentinela e ruido e a gente
-- desliga sem drama. Isso so se sabe medindo, e medir depois de ligar e tarde
-- — por isso a instrumentacao nasce junto, nao vira "a gente vê depois".
create table if not exists public.sentinela_sugestoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  mentor_id uuid references auth.users(id) on delete set null,
  -- O que o modelo sugeriu. Guardado porque sem isso nao da para entender
  -- POR QUE a taxa de aceite e alta ou baixa — e o numero sozinho nao ensina.
  sugestao text not null,
  -- Preenchido quando o mentor de fato manda algo: aceita como veio, editada
  -- ou ignorada. A diferenca entre as tres e o que separa "ajuda" de "atrapalha".
  desfecho text check (desfecho in ('aceita', 'editada', 'ignorada')),
  respondido_em timestamptz,
  fornecedor text,
  created_at timestamptz not null default now()
);

alter table public.sentinela_sugestoes enable row level security;

-- So a ArkeFit: o canal do Mentor e invisivel para a academia, e a sugestao
-- e feita sobre o conteudo dele.
drop policy if exists "leitura" on public.sentinela_sugestoes;
create policy "leitura" on public.sentinela_sugestoes
  for select to authenticated
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

drop policy if exists "alteração" on public.sentinela_sugestoes;
create policy "alteração" on public.sentinela_sugestoes
  for update to authenticated
  using (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  )
  with check (
    has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

grant select, update on public.sentinela_sugestoes to authenticated;
grant all on public.sentinela_sugestoes to service_role;

create index if not exists idx_sentinela_sugestoes_aluno
  on public.sentinela_sugestoes (aluno_id, created_at desc);

-- A medida de valor do recurso, num lugar so.
create or replace function public.sentinela_taxa_de_aceite(_dias integer default 30)
returns table(sugeridas bigint, respondidas bigint, aceitas bigint, editadas bigint, ignoradas bigint, aproveitamento_pct numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*),
         count(*) filter (where s.desfecho is not null),
         count(*) filter (where s.desfecho = 'aceita'),
         count(*) filter (where s.desfecho = 'editada'),
         count(*) filter (where s.desfecho = 'ignorada'),
         -- Editada conta como aproveitada: o modelo poupou o comeco do
         -- trabalho, que e a maior parte dele. So ignorada e desperdicio.
         case when count(*) filter (where s.desfecho is not null) > 0
              then round(
                count(*) filter (where s.desfecho in ('aceita','editada'))::numeric * 100
                / count(*) filter (where s.desfecho is not null), 1)
         end
    from public.sentinela_sugestoes s
   where s.created_at >= now() - make_interval(days => greatest(_dias, 1));
$$;

comment on function public.sentinela_taxa_de_aceite(integer) is
  'Aproveitamento das sugestoes do Sentinela. Editada conta como aproveitada: o modelo poupou o comeco do trabalho.';

revoke execute on function public.sentinela_taxa_de_aceite(integer) from public;
grant execute on function public.sentinela_taxa_de_aceite(integer) to authenticated, service_role;
