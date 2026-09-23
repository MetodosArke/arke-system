-- Repasse por nível, dentro da academia (23/09/2026).
--
-- Decisão do responsável: manter **dois níveis** (Integrado e Elite) em vez de
-- colapsar tudo num "Método" único. Isso tem uma consequência que a
-- configuração por organização sozinha não cobria: com um repasse só, os dois
-- níveis reteriam o mesmo valor — e eles custam coisas diferentes de servir.
-- Elite entrega acolhimento expandido, encontros periódicos e fila
-- prioritária, que no modelo de Mentor Centralizado é tempo de gente. Antes da
-- Fase 1 eles já diferiam (R$ 45 e R$ 85); voltar a igualá-los seria um
-- retrocesso disfarçado de simplificação.
--
-- O desenho é default + exceção, para não obrigar a configurar duas vezes quem
-- negociou um valor só:
--
--   `organizations.repasse_*`                      → o negociado com a academia
--   `organization_planos_precificacao.repasse_*`   → exceção daquele nível
--
-- `organization_planos_precificacao` já era a tabela com uma linha por
-- (organização, nível), então a exceção mora onde o varejo daquele nível já
-- morava — e não numa tabela nova só para isso.

alter table public.organization_planos_precificacao
  add column if not exists repasse_tipo text,
  add column if not exists repasse_valor numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'precificacao_repasse_valido') then
    alter table public.organization_planos_precificacao
      add constraint precificacao_repasse_valido
      check (
        (repasse_tipo is null and repasse_valor is null)
        or (
          repasse_tipo in ('fixo', 'percentual')
          and repasse_valor >= 0
          and (repasse_tipo <> 'percentual' or repasse_valor <= 100)
        )
      );
  end if;
end $$;

comment on column public.organization_planos_precificacao.repasse_valor is
  'Excecao do repasse para este nivel. Nulo = vale o negociado com a academia em organizations.repasse_valor.';

-- Troca de assinatura: `create or replace` não muda a lista de argumentos.
drop function if exists public.repasse_arke(uuid, numeric);

-- `_nivel_atacado` como texto, e não como o enum, para a RPC não depender do
-- nome do tipo e para a chamada sem nível continuar valendo (mensalidade de
-- plano próprio não tem nível).
create or replace function public.repasse_arke(
  _organization_id uuid,
  _valor_cobrado numeric,
  _nivel_atacado text default null
)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  with escolhido as (
    select coalesce(pp.repasse_tipo, o.repasse_tipo) as tipo,
           coalesce(pp.repasse_valor, o.repasse_valor) as valor
      from public.organizations o
      left join public.organization_planos_precificacao pp
        on pp.organization_id = o.id
       and _nivel_atacado is not null
       and pp.nivel_atacado::text = _nivel_atacado
       -- Linha sem exceção não deve suprimir o default da academia.
       and pp.repasse_valor is not null
     where o.id = _organization_id
  )
  select case
           when e.valor is null then null
           when e.tipo = 'percentual'
             then round(coalesce(_valor_cobrado, 0) * e.valor / 100, 2)
                  + public.arke_taxa_processamento(_valor_cobrado)
           else round(e.valor, 2) + public.arke_taxa_processamento(_valor_cobrado)
         end
    from escolhido e;
$$;

comment on function public.repasse_arke(uuid, numeric, text) is
  'Quanto a ArkeFit retem de uma cobranca do Metodo: a excecao do nivel, senao o negociado com a academia, mais a taxa. NULL quando nao ha repasse negociado.';

revoke execute on function public.repasse_arke(uuid, numeric, text) from public;
grant execute on function public.repasse_arke(uuid, numeric, text) to authenticated, service_role;
