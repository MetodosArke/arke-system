-- Preservação dos registros de acesso por ordem judicial (06/10/2026).
--
-- A Política (seção 7, redação do advogado no memorando de 06/10/2026) diz que
-- os registros de acesso saem depois de 6 meses "inexistindo ordem judicial em
-- contrário". O Marco Civil (art. 15, § 2º, com os §§ 3º e 4º do art. 13)
-- permite à autoridade pedir que os registros de alguém sejam guardados por
-- mais tempo. Sem esta tabela, a rotina da migration 20261380 apagaria do
-- mesmo jeito.
--
-- A ArkeFit registra a ordem aqui, por SQL, com o número do processo ou do
-- ofício e até quando vale; enquanto valer, os registros daquela pessoa não
-- saem. Ninguém lê nem grava pela API.

set lock_timeout = '5s';

create table if not exists public.registros_acesso_preservacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  ate date not null,
  ordem text not null check (length(btrim(ordem)) > 0),
  criado_em timestamptz not null default now()
);

create index if not exists idx_registros_acesso_preservacoes_user on public.registros_acesso_preservacoes (user_id, ate);

comment on table public.registros_acesso_preservacoes is
  'Ordem judicial ou pedido de autoridade para guardar os registros de acesso de alguem alem dos 6 meses (Marco Civil, art. 15, par. 2). So a ArkeFit, por SQL.';

alter table public.registros_acesso_preservacoes enable row level security;
revoke all on public.registros_acesso_preservacoes from anon, authenticated;

create or replace function public.limpar_registros_acesso_aplicacao()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.registros_acesso_aplicacao r
   where r.dia < (current_date - interval '6 months')::date
     and not exists (
       select 1 from public.registros_acesso_preservacoes p
        where p.user_id = r.user_id and p.ate >= current_date
     );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.limpar_registros_acesso_aplicacao() from public, anon, authenticated;
grant execute on function public.limpar_registros_acesso_aplicacao() to service_role;
