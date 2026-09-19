-- Redirecionador curto (arkefit.com.br/cadastro/<code>) para os links de
-- ativação/definição de senha gerados pelo Supabase Auth
-- (auth.admin.generateLink) — o link "cru" é gigante (domínio técnico do
-- projeto + token de uso único), ruim de colar como texto numa mensagem
-- de WhatsApp. Só a edge function `ativar-cadastro` (service_role) lê e
-- escreve aqui; sem policy nenhuma, RLS habilitada bloqueia qualquer
-- acesso via client (mesmo padrão de asaas_webhook_events).
create table public.links_ativacao (
  code text primary key,
  action_link text not null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.links_ativacao is
  'Mapeia um código curto (usado em arkefit.com.br/cadastro/<code>, via rewrite '
  'do vercel.json) para o action_link real gerado pelo Supabase Auth. O código '
  'não expira no primeiro acesso — só por tempo (expires_at) — porque o próprio '
  'WhatsApp busca a URL para gerar a prévia da mensagem antes do aluno clicar; '
  'invalidar no primeiro acesso quebraria esse fluxo. O token dentro do '
  'action_link continua sendo de uso único, então isso não abre brecha alguma.';

create index links_ativacao_expires_at_idx on public.links_ativacao (expires_at);

alter table public.links_ativacao enable row level security;
