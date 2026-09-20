-- Importação de alunos em lote: estado durável e retomável.
--
-- Como estava: o progresso vivia inteiro em `useState` do componente React.
-- Uma academia de 400 alunos levava de 10 a 30 minutos com a aba
-- obrigatoriamente aberta, e qualquer refresh, notebook suspendendo ou
-- clique errado apagava tudo — sem saber quais linhas já tinham entrado. O
-- caminho de recuperação era reimportar a planilha inteira e ver 250 erros
-- de "já existe usuário com esse e-mail" antes de chegar nas que faltavam.
--
-- Com o alvo de operar sem intervenção manual, isso não se sustenta: é
-- justamente o tipo de tarefa que alguém precisa babysittar.
--
-- O estado passa a viver aqui. Some do navegador, continua no banco.

create table if not exists public.importacoes_alunos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  criado_por       uuid,
  arquivo_nome     text,
  total_linhas     integer not null,
  status           text not null default 'em_andamento'
                   check (status in ('em_andamento', 'concluida', 'cancelada')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_importacoes_alunos_org
  on public.importacoes_alunos (organization_id, created_at desc);

create table if not exists public.importacoes_alunos_linhas (
  id               uuid primary key default gen_random_uuid(),
  importacao_id    uuid not null references public.importacoes_alunos(id) on delete cascade,
  -- Desnormalizado de propósito: regra 1 do projeto é toda tabela carregar
  -- organization_id para a policy de RLS não depender de join.
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  numero           integer not null,
  -- O registro já mapeado pelo de-para de colunas. Guardar o dado, e não a
  -- linha crua da planilha, é o que permite retomar sem o arquivo original
  -- — quem reabre a tela amanhã não tem mais o .xlsx à mão.
  dados            jsonb not null,
  status           text not null default 'pendente'
                   check (status in ('pendente', 'sucesso', 'erro')),
  mensagem         text,
  user_id_criado   uuid,
  processado_em    timestamptz
);

create unique index if not exists idx_importacoes_linhas_unica
  on public.importacoes_alunos_linhas (importacao_id, numero);

-- Índice do caminho quente: "me dê as pendentes desta importação".
create index if not exists idx_importacoes_linhas_pendentes
  on public.importacoes_alunos_linhas (importacao_id, status)
  where status = 'pendente';

alter table public.importacoes_alunos enable row level security;
alter table public.importacoes_alunos_linhas enable row level security;

create policy "staff da org gerencia as próprias importações"
  on public.importacoes_alunos for all to authenticated
  using (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  )
  with check (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  );

create policy "staff da org gerencia as linhas das próprias importações"
  on public.importacoes_alunos_linhas for all to authenticated
  using (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  )
  with check (
    public.is_org_staff(( select auth.uid() ), organization_id)
    or public.has_role(( select auth.uid() ), 'admin_arke')
    or public.has_role(( select auth.uid() ), 'superadmin')
  );

create trigger trg_importacoes_alunos_updated_at
  before update on public.importacoes_alunos
  for each row execute function public.set_updated_at();
