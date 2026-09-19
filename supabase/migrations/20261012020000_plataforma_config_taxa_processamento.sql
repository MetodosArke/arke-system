-- Configuração global da plataforma (só Super Admin/admin_arke mexe).
-- Primeiro uso: a taxinha de processamento que a ARKE retém sobre a
-- mensalidade da academia cobrada via Asaas nativo (academia-criar-
-- matricula) — cobre o custo real que o Asaas cobra da ARKE pra
-- processar o pagamento. Mesmo mecanismo de repasse já usado no
-- Método ARKE (valor_repasse_arke/valor_liquido_academia), só que a
-- fonte do valor aqui é essa taxa configurável, não o custo de
-- atacado de um nível.
create table public.plataforma_config (
  id          uuid primary key default gen_random_uuid(),
  chave       text not null unique,
  valor       numeric(10,4) not null,
  descricao   text,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_plataforma_config_updated_at
  before update on public.plataforma_config
  for each row execute function public.set_updated_at();

alter table public.plataforma_config enable row level security;

create policy "admin_arke gerencia plataforma_config"
  on public.plataforma_config for all
  to authenticated
  using (public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_role((select auth.uid()), 'admin_arke'));

insert into public.plataforma_config (chave, valor, descricao) values
  ('taxa_processamento_percentual', 2.99, 'Percentual retido pela ARKE sobre mensalidades da academia cobradas via Asaas nativo, cobrindo o custo de processamento do Asaas.'),
  ('taxa_processamento_fixa', 0.49, 'Valor fixo (R$) retido pela ARKE por cobrança de mensalidade da academia via Asaas nativo, somado ao percentual.');

-- Snapshot do repasse calculado na hora da matrícula (o split já fica
-- travado na assinatura do Asaas desde a criação — mudar a config
-- depois não altera assinaturas já existentes, só as novas).
alter table public.aluno_matriculas_academia
  add column valor_repasse_arke numeric(10,2) not null default 0,
  add column valor_liquido_academia numeric(10,2) not null default 0;

alter table public.mensalidades
  add column valor_repasse_arke numeric(10,2) not null default 0,
  add column valor_liquido_academia numeric(10,2) not null default 0;
