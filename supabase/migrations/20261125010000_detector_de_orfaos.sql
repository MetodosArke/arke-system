-- Detector de linhas órfãs — fecha a pendência mais antiga do CLAUDE.md.
--
-- Em setembro, 18 linhas sobreviveram à exclusão das organizações-pai
-- mesmo com as chaves estrangeiras marcadas ON DELETE CASCADE e validadas.
-- A hipótese registrada era limpeza rodada com
-- `session_replication_role = 'replica'`, que desliga os triggers de FK.
-- Ela foi testada em 21/09/2026, em transação revertida, e confirmada:
--
--   mesma exclusão, triggers ligados  → 0 órfãos (o cascade funciona)
--   mesma exclusão, modo replica      → 1 órfão (a linha filha sobreviveu)
--
-- Ou seja: o cascade nunca esteve quebrado. O que quebra é excluir tenant
-- por fora do produto com os triggers desligados — e isso não deixa erro,
-- só rastro.
--
-- Como a causa é operacional e não estrutural, a defesa também é: em vez
-- de tentar impedir (não dá — quem tem privilégio para trocar o modo tem
-- privilégio para tudo), torna-se barato conferir. Esta função varre todas
-- as chaves estrangeiras que apontam para `organizations` e conta o que
-- ficou apontando para o vazio, sem precisar manter lista de tabelas à
-- mão: tabela nova entra na varredura sozinha.

create or replace function public.verificar_orfaos()
returns table (tabela text, coluna text, orfaos bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n bigint;
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Apenas a ArkeFit pode verificar linhas órfãs.';
  end if;

  for r in
    select c.conrelid::regclass::text as tab,
           a.attname::text            as col
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.organizations'::regclass
       and array_length(c.conkey, 1) = 1
  loop
    execute format(
      'select count(*) from %s t where t.%I is not null
         and not exists (select 1 from public.organizations o where o.id = t.%I)',
      r.tab, r.col, r.col
    ) into n;

    if n > 0 then
      tabela := r.tab;
      coluna := r.col;
      orfaos := n;
      return next;
    end if;
  end loop;
end;
$$;

comment on function public.verificar_orfaos() is
  'Varre as FKs que apontam para organizations e conta linhas órfãs. Rodar após qualquer exclusão de tenant feita fora do produto — ver migration 20261125010000.';

revoke all on function public.verificar_orfaos() from public, anon;
grant execute on function public.verificar_orfaos() to authenticated;
