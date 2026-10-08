-- O nome de exibição de quem é da equipe por nível (08/10/2026).
--
-- `renomear_equipe_arkefit` (20261430) só aceitava a conta com papel da
-- ArkeFit em `user_roles`. Os níveis da equipe contratada (20261422 em diante)
-- moram em `equipe_arkefit.niveis` e nunca gravam `user_roles`: o sócio não
-- conseguiria corrigir o nome de um Mentor ou de alguém do Suporte. A conta
-- vale como da equipe também quando tem a linha em `equipe_arkefit`, como a
-- lista da Equipe já mostra. Quem chama continua sendo só o sócio verificado.

set lock_timeout = '5s';

create or replace function public.renomear_equipe_arkefit(_user_id uuid, _nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
  v_nome text := nullif(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), '');
  v_antes text;
begin
  if not public.has_role(v_ator, 'superadmin') or public.sessao_simulada() then
    raise exception 'Só um sócio da ArkeFit, com a verificação em duas etapas, muda o nome de alguém da equipe.' using errcode = '42501';
  end if;
  if _user_id is null
     or (not exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role = any(public.papeis_da_arkefit()))
         and not exists (select 1 from public.equipe_arkefit e where e.user_id = _user_id)) then
    raise exception 'Essa conta não é da equipe ArkeFit.' using errcode = '22023';
  end if;
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe um nome de 2 a 120 letras.' using errcode = '22023';
  end if;

  select p.full_name into v_antes from public.profiles p where p.user_id = _user_id for update;
  if v_antes is not distinct from v_nome then
    return;
  end if;

  insert into public.profiles (user_id, full_name, status)
  values (_user_id, v_nome, 'active')
  on conflict (user_id) do update set full_name = excluded.full_name;

  perform public.registrar_auditoria(
    v_ator, 'equipe_arkefit.nome_alterado', 'auth.users', _user_id, null,
    jsonb_build_object('mudou', 'nome')
  );
end;
$$;
