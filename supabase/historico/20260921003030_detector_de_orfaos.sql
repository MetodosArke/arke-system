-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

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
  'Varre as FKs que apontam para organizations e conta linhas órfãs. Rodar após qualquer exclusão de tenant feita fora do produto.';

revoke all on function public.verificar_orfaos() from public, anon;
grant execute on function public.verificar_orfaos() to authenticated;
