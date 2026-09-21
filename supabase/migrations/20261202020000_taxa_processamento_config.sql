-- As duas partes da taxa de processamento, para a tela de precificação da
-- academia mostrar a prévia do split enquanto o valor é digitado — sem uma
-- chamada ao banco por tecla. plataforma_config continua restrita à ArkeFit;
-- isto expõe só as duas taxas, que não são segredo (aparecem no split).
create or replace function public.arke_taxa_processamento_config()
returns table(percentual numeric, fixa numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_percentual'), 0),
    coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_fixa'), 0);
$$;

revoke execute on function public.arke_taxa_processamento_config() from public, anon;
grant execute on function public.arke_taxa_processamento_config() to authenticated, service_role;
