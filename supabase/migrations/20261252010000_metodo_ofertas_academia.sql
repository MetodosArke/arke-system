-- Método ARKE à venda desde o primeiro dia (decisão do responsável,
-- 23/09/2026).
--
-- Até aqui o app anunciava o Método como "breve lançamento" e a adesão pela
-- academia ficava atrás de um interruptor desligado. Com a venda valendo no
-- dia 1, o anúncio passa a oferecer — e por isso precisa saber se a academia
-- de fato vende. Anunciar o Método a quem não pode comprá-lo (academia sem
-- repasse negociado, sem preço de varejo) seria mandar o aluno à recepção
-- atrás de algo que não existe.
--
-- A academia oferece um nível quando ele está disponível na tabela da
-- ArkeFit, tem preço de varejo e o varejo cobre o repasse — as mesmas
-- condições que asaas-create-subscription confere antes de cobrar.
create or replace function public.metodo_ofertas_academia(_organization_id uuid)
returns table(nivel text, valor_varejo numeric)
language sql
stable
security definer
set search_path = public
as $$
  select pp.nivel_atacado::text, pp.valor_varejo
    from public.organization_planos_precificacao pp
    join public.planos_atacado pa on pa.id = pp.nivel_atacado and pa.disponivel
   where pp.organization_id = _organization_id
     and pp.nivel_atacado::text in ('integrado', 'elite')
     and coalesce(pp.valor_varejo, 0) > 0
     and public.repasse_arke(_organization_id, pp.valor_varejo, pp.nivel_atacado::text) is not null
     and pp.valor_varejo > public.repasse_arke(_organization_id, pp.valor_varejo, pp.nivel_atacado::text)
     and (exists (select 1 from public.organization_members m
                   where m.organization_id = _organization_id and m.user_id = auth.uid() and m.status = 'active')
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke'))
   order by pp.valor_varejo;
$$;
revoke execute on function public.metodo_ofertas_academia(uuid) from public, anon;
grant execute on function public.metodo_ofertas_academia(uuid) to authenticated;
