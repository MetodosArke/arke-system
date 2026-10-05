-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

create or replace function public.get_superadmin_fila_mentor()
returns table (
  aluno_id uuid,
  aluno_nome text,
  organizacao_nome text,
  plano text,
  ultima_mensagem text,
  ultima_em timestamptz,
  ultimo_remetente text,
  nao_lidas bigint
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (public.has_role(auth.uid(), 'admin_arke') or public.has_role(auth.uid(), 'superadmin')) then
    raise exception 'Apenas a ArkeFit acessa a fila de mentoria.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select a.id,
         coalesce(p.full_name, 'Aluno'),
         o.nome,
         public.plano_do_aluno(a.metodo_arke_status, a.nivel_atacado),
         ultima.mensagem,
         ultima.created_at,
         ultima.remetente_tipo::text,
         coalesce(pendentes.total, 0)
    from public.alunos a
    join public.organizations o on o.id = a.organization_id
    left join public.profiles p on p.user_id = a.user_id
    join lateral (
      select m.mensagem, m.created_at, m.remetente_tipo
        from public.mensagens_mentor m
       where m.aluno_id = a.id
       order by m.created_at desc
       limit 1
    ) ultima on true
    left join lateral (
      select count(*) as total
        from public.mensagens_mentor m
       where m.aluno_id = a.id and m.remetente_tipo = 'aluno' and not m.lida
    ) pendentes on true
   order by (coalesce(pendentes.total, 0) > 0) desc,
            case when coalesce(pendentes.total, 0) > 0 then ultima.created_at end asc,
            ultima.created_at desc;
end;
$$;

revoke execute on function public.get_superadmin_fila_mentor() from public, anon;
grant execute on function public.get_superadmin_fila_mentor() to authenticated;
