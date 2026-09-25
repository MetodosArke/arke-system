-- Contatos da página de vendas (Fase 2 da rodada de lançamento, 25/09/2026).
--
-- O formulário de arkefit.com.br grava aqui, pela edge function `lead-site`
-- (service role), e avisa o e-mail do comercial (decisão 10: os dois). Quem
-- lê e trabalha os contatos é a ArkeFit, em Visão Master → Contatos do site.
-- Não há regra de inclusão para o cliente: o único caminho de entrada é a
-- função, que confere o captcha e o limite por IP antes de gravar.

create table public.leads_site (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 2 and 120),
  academia text not null check (char_length(academia) between 2 and 160),
  cidade text check (char_length(cidade) <= 120),
  uf text check (uf ~ '^[A-Z]{2}$'),
  telefone text not null check (char_length(telefone) between 10 and 20),
  email text not null check (char_length(email) <= 200 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  alunos_faixa text check (alunos_faixa in ('ate_150', '151_500', '501_1000', 'mais_1000')),
  sistema_atual text check (char_length(sistema_atual) <= 80),
  mensagem text check (char_length(mensagem) <= 2000),
  origem text check (char_length(origem) <= 200),
  status text not null default 'novo'
    check (status in ('novo', 'em_contato', 'demonstracao', 'proposta', 'fechado', 'descartado')),
  observacao text check (char_length(observacao) <= 2000),
  atualizado_em timestamptz,
  atualizado_por uuid,
  -- IP é dado pessoal: guarda-se só o hash com pimenta, para o limite por
  -- origem, como na matrícula pública.
  ip_hash text,
  email_enviado_em timestamptz
);

comment on table public.leads_site is
  'Contatos da página de vendas. Inclusão só pela edge function lead-site; leitura e alteração só da ArkeFit.';

create index leads_site_created_at_idx on public.leads_site (created_at desc);
create index leads_site_ip_idx on public.leads_site (ip_hash, created_at);

alter table public.leads_site enable row level security;

-- Uma regra por operação. `has_role` já exige a sessão verificada em duas
-- etapas para os papéis da ArkeFit.
create policy "leitura" on public.leads_site for select to authenticated
  using (has_role((select auth.uid()), 'superadmin'::app_role) or has_role((select auth.uid()), 'admin_arke'::app_role));
create policy "alteração" on public.leads_site for update to authenticated
  using (has_role((select auth.uid()), 'superadmin'::app_role) or has_role((select auth.uid()), 'admin_arke'::app_role))
  with check (has_role((select auth.uid()), 'superadmin'::app_role) or has_role((select auth.uid()), 'admin_arke'::app_role));

revoke all on public.leads_site from anon, authenticated;
grant select, update on public.leads_site to authenticated;
grant all on public.leads_site to service_role;

-- Quem muda o status fica registrado.
create or replace function public.carimbar_lead_site()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Só o trabalho da ArkeFit carimba; o aviso de e-mail da função, não.
  if new.status is distinct from old.status or new.observacao is distinct from old.observacao then
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
  end if;
  return new;
end;
$$;
revoke execute on function public.carimbar_lead_site() from public, anon, authenticated;

create trigger trg_carimbar_lead_site
  before update on public.leads_site
  for each row execute function public.carimbar_lead_site();

-- Para onde vai o aviso de contato novo. Editável em Visão Master →
-- Configurações; vazio, o aviso vai para os Super Admins.
insert into public.plataforma_textos (chave, valor, descricao)
values ('comercial_email', 'comercial@metodosarke.com.br', 'E-mail que recebe os contatos da página de vendas.')
on conflict (chave) do nothing;
