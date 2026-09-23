-- Registro por série: carga e repetições de cada série executada.
--
-- Trazido do app original (rodada de 23/09/2026). Até aqui o sistema novo
-- guardava **uma carga por exercício**, em `registro_treino.detalhes_execucao`
-- (`{ordem, concluido, carga_kg}`). Isso não descreve o que acontece na
-- academia: a série pirâmide sobe a carga a cada série, o drop-set desce, e um
-- número só apaga justamente a informação que o professor usa para progredir.
--
-- A chave da progressão é `exercicio_id`, não a ordem no snapshot. A ficha é
-- republicada a cada revisão, e com ela nasce um `treino_id` novo; a ordem do
-- supino pode mudar de 3 para 1, mas o exercício é o mesmo. Comparar por ordem
-- mostraria "carga anterior" de outro movimento — o tipo de erro que o aluno
-- acredita porque o número parece plausível.
--
-- `exercicio_ordem` fica junto porque é o que amarra a série ao item do
-- snapshot na tela, e porque ficha publicada antes do acervo não tem
-- `exercicio_id` (a coluna nasceu na rodada 2).

create table if not exists public.registro_serie (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  registro_treino_id uuid not null references public.registro_treino(id) on delete cascade,
  -- Nulo em ficha antiga, sem vínculo com a biblioteca. A progressão então
  -- só compara dentro da mesma ficha, que é o melhor possível nesse caso.
  exercicio_id uuid references public.exercicios_biblioteca(id) on delete set null,
  exercicio_ordem integer not null,
  serie_numero integer not null check (serie_numero between 1 and 20),
  -- Carga em quilos, com meio quilo de resolução: anilha de 1,25 kg existe e
  -- arredondar para inteiro faria a progressão sumir em exercício pequeno.
  carga_kg numeric(6,2) check (carga_kg is null or (carga_kg >= 0 and carga_kg <= 999)),
  repeticoes integer check (repeticoes is null or (repeticoes >= 0 and repeticoes <= 999)),
  concluida boolean not null default false,
  created_at timestamptz not null default now(),
  -- Uma linha por série de cada exercício da sessão. Sem isto, tocar duas
  -- vezes no mesmo botão criaria séries duplicadas e inflaria o volume.
  unique (registro_treino_id, exercicio_ordem, serie_numero)
);

create index if not exists idx_registro_serie_registro on public.registro_serie (registro_treino_id);
-- O índice da progressão: "qual foi minha última carga neste exercício".
create index if not exists idx_registro_serie_exercicio on public.registro_serie (exercicio_id, created_at desc);
create index if not exists idx_registro_serie_org on public.registro_serie (organization_id);

alter table public.registro_serie enable row level security;

-- Uma regra por operação, como manda a consolidação de 21/09. O aluno gerencia
-- as próprias séries; a equipe da academia e a ArkeFit leem, porque é disso
-- que o professor precisa para prescrever a próxima carga — mas não escrevem:
-- quem registra o que levantou é quem levantou.
create policy "leitura" on public.registro_serie for select to authenticated
using (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_serie.registro_treino_id
            and a.user_id = (select auth.uid()))
  or public.is_org_staff((select auth.uid()), organization_id)
  or public.has_role((select auth.uid()), 'admin_arke')
);

create policy "inclusão" on public.registro_serie for insert to authenticated
with check (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_serie.registro_treino_id
            and a.user_id = (select auth.uid()))
);

create policy "alteração" on public.registro_serie for update to authenticated
using (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_serie.registro_treino_id
            and a.user_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_serie.registro_treino_id
            and a.user_id = (select auth.uid()))
);

create policy "exclusão" on public.registro_serie for delete to authenticated
using (
  exists (select 1 from public.alunos a
           join public.registro_treino r on r.aluno_id = a.id
          where r.id = registro_serie.registro_treino_id
            and a.user_id = (select auth.uid()))
);

comment on table public.registro_serie is
  'Carga e repetições de cada série executada. A progressão é lida por exercicio_id, que sobrevive à republicação da ficha.';

-- Avaliação pós-treino, do original: como o aluno se sentiu na sessão.
--
-- Mora em `registro_treino` e não em tabela nova porque é um atributo da
-- sessão, um por registro. `esforco_percebido` é a escala de 1 a 10 (RPE), que
-- é o que permite ao professor distinguir "não progrediu porque está leve" de
-- "não progrediu porque está no limite".
alter table public.registro_treino
  add column if not exists esforco_percebido smallint
    check (esforco_percebido is null or esforco_percebido between 1 and 10),
  add column if not exists sensacao text
    check (sensacao is null or sensacao in ('otimo', 'bom', 'regular', 'dificil', 'dor')),
  add column if not exists duracao_min integer
    check (duracao_min is null or (duracao_min >= 0 and duracao_min <= 600));

comment on column public.registro_treino.esforco_percebido is
  'Escala de esforço percebido (RPE) de 1 a 10, respondida ao concluir o treino.';
comment on column public.registro_treino.duracao_min is
  'Duração da sessão em minutos, medida pela tela de execução.';
