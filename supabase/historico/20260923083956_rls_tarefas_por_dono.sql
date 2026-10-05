-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- A fila do Mentor nao aparece para a academia (23/09/2026).
--
-- Sem isto o BPO quebra na primeira tela: o gestor continuaria vendo as
-- tarefas que a ArkeFit assumiu, e a promessa de "zero carga digital" viraria
-- uma lista maior do que antes — agora com casos que ele nem deve tratar.
--
-- A trava mora no RLS e nao nas consultas porque sao seis telas lendo
-- `tarefas` hoje, e a setima nasceria sem o filtro. Aqui nenhuma esquece.
--
-- Uma regra por operacao, como manda o formato consolidado: a condicao de
-- dono entra NA regra existente, nao numa regra nova que se somaria por OU —
-- o que justamente anularia o filtro.
alter policy "leitura" on public.tarefas
  using (
    (
      is_org_staff((select auth.uid()), organization_id)
      -- A academia so enxerga o que e dela. O que a ArkeFit assumiu some da
      -- lista dela: e o ponto do BPO.
      and dono = 'academia'
    )
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

alter policy "alteração" on public.tarefas
  using (
    (is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

alter policy "exclusão" on public.tarefas
  using (
    (is_org_staff((select auth.uid()), organization_id) and dono = 'academia')
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );
