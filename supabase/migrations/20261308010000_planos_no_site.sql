-- A tabela B2B na página de vendas (decisão do responsável, 02/10/2026).
--
-- O site mostra o preço lido daqui, e não escrito na página: é a mesma
-- tabela que a cobrança usa (planos_b2b_precos, editada em Visão Master →
-- Configurações), então o site nunca anuncia um preço diferente do que o
-- sistema cobra. Preço escrito à mão diverge na primeira mudança.
--
-- Só os planos à venda, na ordem da página. O autônomo não entra (o preço
-- dele é de outro momento) nem o Starter, que saiu de venda. O Método ARKE
-- fica fora até o preço fixo dele ser definido.
--
-- A página é pública, então a função é a única porta: o visitante sem login
-- não lê a tabela, só o que esta função devolve.

create or replace function public.planos_b2b_site()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'planos', coalesce((
      select jsonb_agg(
        jsonb_build_object('plano', p.plano, 'valor_mensal', p.valor_mensal, 'limite_alunos', p.limite_alunos)
        order by o.ordem
      )
      from (values ('growth'::public.plano_b2b, 1), ('enterprise', 2), ('redes', 3), ('custom', 4)) as o(plano, ordem)
      join public.planos_b2b_precos p on p.plano = o.plano
    ), '[]'::jsonb),
    'implantacao', (select c.valor from public.plataforma_config c where c.chave = 'taxa_implantacao_referencia')
  );
$$;

comment on function public.planos_b2b_site() is
  'Tabela B2B para a página de vendas, sem login: preço e limite de alunos dos planos à venda e a taxa de implantação de referência. Lê planos_b2b_precos, a mesma tabela da cobrança.';

revoke all on function public.planos_b2b_site() from public;
grant execute on function public.planos_b2b_site() to anon, authenticated;
