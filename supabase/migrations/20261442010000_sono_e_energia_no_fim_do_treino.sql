-- Sono e energia no fim do treino (10/10/2026).
--
-- Decisão do responsável: duas perguntas de 1 a 5 no fim do treino, junto do
-- esforço percebido ("Como você dormiu esta noite?" e "Como está sua energia
-- hoje?"), para as curvas semanais da Evolução.
--
-- Por que uma tabela própria, e não duas colunas em `registro_treino`: a
-- recepção lê `registro_treino` (a regra de leitura usa `is_org_staff`, que
-- inclui a recepção), e sono e energia autorrelatados são tratados como dado
-- de saúde, como o relato de dor. Coluna não tem regra própria no RLS, e
-- separar por GRANT de coluna não distingue a recepção do aluno (os dois são
-- `authenticated`). Então a resposta mora ao lado, ligada ao treino como
-- `registro_serie`: sem `aluno_id`, sai em cascata com o treino na exclusão e
-- na anonimização do aluno, e a leitura é a da saúde (`atende_saude`, sem a
-- recepção), como `dieta_adesao`.

set lock_timeout = '5s';

create table if not exists public.registro_treino_bem_estar (
  registro_treino_id uuid primary key references public.registro_treino(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sono smallint check (sono between 1 and 5),
  energia smallint check (energia between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists idx_registro_treino_bem_estar_org on public.registro_treino_bem_estar (organization_id);

alter table public.registro_treino_bem_estar enable row level security;

-- Uma regra por operação, e sem exclusão pela API: a resposta sai com o
-- treino, ou na saída do aluno. Quem responde é o aluno, sobre o próprio treino e
-- na academia dele; a equipe que atende a saúde lê, e a ArkeFit só no Método.
create policy "leitura" on public.registro_treino_bem_estar for select to authenticated
using (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_treino_bem_estar.registro_treino_id
            and a.user_id = (select auth.uid()))
  or public.atende_saude(organization_id)
  or ((select public.equipe_metodo())
      and exists (select 1 from public.registro_treino r
                   where r.id = registro_treino_bem_estar.registro_treino_id
                     and public.aluno_no_metodo(r.aluno_id)))
);

create policy "inclusão" on public.registro_treino_bem_estar for insert to authenticated
with check (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_treino_bem_estar.registro_treino_id
            and r.organization_id = registro_treino_bem_estar.organization_id
            and a.user_id = (select auth.uid()))
);

create policy "alteração" on public.registro_treino_bem_estar for update to authenticated
using (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_treino_bem_estar.registro_treino_id
            and a.user_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_treino_bem_estar.registro_treino_id
            and r.organization_id = registro_treino_bem_estar.organization_id
            and a.user_id = (select auth.uid()))
);

-- Dado de pessoa: as duas etapas da gestão valem aqui também (20261363010000).
drop policy if exists "duas etapas" on public.registro_treino_bem_estar;
create policy "duas etapas" on public.registro_treino_bem_estar as restrictive for all to authenticated
  using ((select public.sessao_cumpre_duas_etapas()))
  with check ((select public.sessao_cumpre_duas_etapas()));
