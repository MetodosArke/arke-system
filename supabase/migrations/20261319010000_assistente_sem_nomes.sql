-- O assistente da academia com o modelo de fora do Brasil (decisão do
-- responsável, 03/10/2026): o mesmo modelo do Vigia, pelo perfil `global.`.
--
-- A pergunta da equipe passa a sair do país, e por isso sai sem
-- identificação. CPF, e-mail e telefone já saíam antes; esta função entrega
-- os nomes de quem está na academia (alunos e equipe), para a edge function
-- trocar cada um por "[nome]" antes do envio. Os nomes não saem daqui: a
-- lista fica dentro da função, e só a service role a lê.
--
-- Sem a lista, a pergunta não vai ao modelo: `assistente-academia` trata a
-- falha desta função como IA indisponível.

create or replace function public.nomes_para_anonimizar(_organization_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct nome), '{}')
    from (
      select p.full_name as nome
        from public.organization_members m
        join public.profiles p on p.user_id = m.user_id
       where m.organization_id = _organization_id
      union
      select p.full_name
        from public.alunos a
        join public.profiles p on p.user_id = a.user_id
       where a.organization_id = _organization_id
    ) n
   where nullif(trim(nome), '') is not null;
$$;

revoke execute on function public.nomes_para_anonimizar(uuid) from public, anon, authenticated;
grant execute on function public.nomes_para_anonimizar(uuid) to service_role;

comment on function public.nomes_para_anonimizar(uuid) is
  'Nomes de alunos e equipe da academia, para o assistente tirar da pergunta antes de mandá-la ao modelo. Só a service role.';
