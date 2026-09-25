-- Exportação completa dos dados da academia (24/09/2026).
--
-- O contrato promete, no encerramento, 30 dias para a academia exportar os
-- dados dela (cláusula 6, item 7) — e a academia é a controladora dos dados
-- dos alunos. A exportação sai no navegador, com o RLS de sempre; o único dado
-- que o painel não lê é o e-mail, que mora no Auth. Esta função entrega só
-- isso, e só para a gestão da própria academia.
create or replace function public.emails_alunos_organizacao(_organization_id uuid)
returns table (aluno_id uuid, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_org_role(auth.uid(), _organization_id, 'gestor') then
    raise exception 'Só a gestão da academia exporta os dados dela.' using errcode = '42501';
  end if;
  return query
  select a.id, u.email::text
    from public.alunos a
    join auth.users u on u.id = a.user_id
   where a.organization_id = _organization_id
   order by a.id;
end;
$$;
revoke execute on function public.emails_alunos_organizacao(uuid) from public, anon;
grant execute on function public.emails_alunos_organizacao(uuid) to authenticated;
