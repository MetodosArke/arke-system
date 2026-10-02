-- Método ARKE: a tabela de atacado de referência, editável pela ArkeFit (02/10/2026).
--
-- `planos_atacado` guarda, por nível, o repasse de referência da ArkeFit
-- (`custo_mensal`) e o preço sugerido ao aluno (`valor_sugerido_varejo`). Desde
-- 23/09/2026 o repasse que vale na cobrança é o negociado na organização
-- (`repasse_arke()`), então a tabela é o ponto de partida da negociação, e não
-- um valor que se aplica sozinho: academia sem repasse negociado continua sem
-- cobrar o Método. Cair na tabela por omissão cobraria o aluno com uma divisão
-- que ninguém acordou.
--
-- 1. A gravação aceitava só o papel antigo `admin_arke`, e as contas só de
--    Super Admin ficavam de fora — o mesmo defeito que 20261286010000 corrigiu
--    na leitura de outras tabelas.
-- 2. Valores positivos: `seed_precificacao_sugerida()` divide pelo custo.
-- 3. `aplicar_repasse_referencia()`: grava a tabela como o repasse negociado de
--    uma academia, num clique e auditado. O padrão da academia fica com o
--    Integrado; o nível com valor diferente ganha a exceção dele.

alter policy "inclusão" on public.planos_atacado
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
alter policy "alteração" on public.planos_atacado
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
alter policy "exclusão" on public.planos_atacado
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
alter policy "leitura" on public.planos_atacado using (true);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'planos_atacado_valores_positivos') then
    alter table public.planos_atacado
      add constraint planos_atacado_valores_positivos check (custo_mensal > 0 and valor_sugerido_varejo > 0);
  end if;
end $$;

comment on column public.planos_atacado.custo_mensal is
  'Repasse de referência da ArkeFit por aluno, em reais, sem a taxa de processamento. Não entra na cobrança sozinho: vale o negociado em organizations.repasse_* e na exceção por nível (repasse_arke()). Serve para aplicar_repasse_referencia() e para o markup inicial das academias novas. Editável em Visão Master → Configurações.';
comment on column public.planos_atacado.valor_sugerido_varejo is
  'Preço ao aluno sugerido pela ArkeFit. Preenche a precificação das academias criadas depois da mudança; as existentes ficam como estão.';

create or replace function public.aplicar_repasse_referencia(_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_org text;
  v_padrao numeric;
  v_niveis jsonb := '{}'::jsonb;
  r record;
begin
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')) then
    raise exception 'Só a ArkeFit define o repasse do Método.' using errcode = '42501';
  end if;

  select nome into v_org from public.organizations where id = _organization_id;
  if not found then
    raise exception 'Organização não encontrada.' using errcode = 'P0002';
  end if;

  select custo_mensal into v_padrao from public.planos_atacado where id = 'integrado' and disponivel;
  if v_padrao is null then
    raise exception 'A tabela de referência não tem o Integrado disponível.' using errcode = '22023';
  end if;

  update public.organizations set repasse_tipo = 'fixo', repasse_valor = v_padrao where id = _organization_id;

  -- A exceção só existe onde a referência do nível difere do padrão; nos
  -- outros níveis ela é limpa, para valer o padrão que acabou de ser gravado.
  for r in select id, custo_mensal, valor_sugerido_varejo from public.planos_atacado where disponivel loop
    insert into public.organization_planos_precificacao
      (organization_id, nivel_atacado, valor_varejo, markup_pct, repasse_tipo, repasse_valor)
    values
      (_organization_id, r.id, r.valor_sugerido_varejo,
       round(((r.valor_sugerido_varejo - r.custo_mensal) / r.custo_mensal) * 100, 2),
       case when r.custo_mensal <> v_padrao then 'fixo' end,
       case when r.custo_mensal <> v_padrao then r.custo_mensal end)
    on conflict (organization_id, nivel_atacado) do update
      set repasse_tipo = excluded.repasse_tipo,
          repasse_valor = excluded.repasse_valor,
          updated_at = now();
    v_niveis := v_niveis || jsonb_build_object(r.id::text, r.custo_mensal);
  end loop;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select v_uid, u.email, 'repasse_metodo.referencia_aplicada', 'organizations', _organization_id, v_org,
         jsonb_build_object('padrao', v_padrao, 'niveis', v_niveis)
    from (select 1) um
    left join auth.users u on u.id = v_uid;

  return jsonb_build_object('padrao', v_padrao, 'niveis', v_niveis);
end;
$function$;

revoke all on function public.aplicar_repasse_referencia(uuid) from public, anon;
grant execute on function public.aplicar_repasse_referencia(uuid) to authenticated;
