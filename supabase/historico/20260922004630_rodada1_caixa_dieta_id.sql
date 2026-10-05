-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

drop function if exists public.get_caixa_mensagens(uuid);
create or replace function public.get_caixa_mensagens(_organization_id uuid)
returns table (
  aluno_id uuid,
  aluno_nome text,
  canal text,
  dieta_id uuid,
  ultima_mensagem text,
  ultima_em timestamptz,
  ultimo_remetente text,
  nao_lidas bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_org_staff(auth.uid(), _organization_id) or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  return query
  with msgs as (
    select m.aluno_id, 'treino'::text as canal, null::uuid as dieta_id, m.mensagem, m.created_at, m.remetente_tipo::text as remetente, m.lida
      from public.mensagens_treino m where m.organization_id = _organization_id
    union all
    select m.aluno_id, 'dieta', m.dieta_id, m.mensagem, m.created_at, m.remetente_tipo::text, m.lida
      from public.mensagens_dieta m where m.organization_id = _organization_id
  ),
  ultima as (
    select distinct on (x.aluno_id, x.canal) x.aluno_id, x.canal, x.dieta_id, x.mensagem, x.created_at, x.remetente
      from msgs x
     order by x.aluno_id, x.canal, x.created_at desc
  ),
  pendentes as (
    select x.aluno_id, x.canal, count(*) as n
      from msgs x where x.remetente = 'aluno' and not x.lida
     group by 1, 2
  )
  select u.aluno_id, coalesce(p.full_name, 'Aluno'), u.canal, u.dieta_id, left(u.mensagem, 160), u.created_at, u.remetente,
         coalesce(pe.n, 0)
    from ultima u
    join public.alunos a on a.id = u.aluno_id
    left join public.profiles p on p.user_id = a.user_id
    left join pendentes pe on pe.aluno_id = u.aluno_id and pe.canal = u.canal
   order by coalesce(pe.n, 0) > 0 desc, u.created_at desc;
end;
$$;

revoke execute on function public.get_caixa_mensagens(uuid) from public, anon;
grant execute on function public.get_caixa_mensagens(uuid) to authenticated;
