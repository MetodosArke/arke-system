-- A troca de papel de alguém da equipe vai para a auditoria também pela API
-- (sobras da frente B, 07/10/2026).
--
-- O que estava errado: `editar-membro-equipe` troca o papel e o nome de
-- alguém da equipe e só registrava a troca do e-mail. A função passa a
-- registrar `equipe.papel_alterado` e `equipe.nome_alterado` (no mesmo PR).
-- Mas a troca de papel tem um segundo caminho: a regra de alteração de
-- `organization_members` deixa a gestão da academia e a ArkeFit alterarem o
-- vínculo direto pela API, e por ali a recepcionista virava gestora sem
-- deixar rastro. O nome não tem esse caminho: a regra de alteração de
-- `profiles` só deixa cada um mudar o próprio.
--
-- A escolha: um gatilho em `organization_members` registra a troca de papel
-- feita com sessão de usuário (`auth.uid()` presente), com o mesmo formato
-- da função: quem trocou, de quem (pelo id), o papel de antes e o de agora,
-- e se foi a ArkeFit, mais `pela_api`. A troca feita pela função roda com a
-- service role, sem `auth.uid()`: o gatilho a deixa passar, e quem registra
-- é a função, que sabe quem pediu. Sem isso, a mesma troca entraria duas
-- vezes, uma delas sem autor.
--
-- O gatilho é `after update of role`: só a troca que gravou entra na trilha,
-- e mudar outra coluna do vínculo (a situação, por exemplo) não o dispara.

set lock_timeout = '5s';

create or replace function public.auditar_troca_de_papel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _ator uuid := auth.uid();
begin
  if _ator is null or new.role is not distinct from old.role then
    return new;
  end if;

  perform public.registrar_auditoria(
    _ator,
    'equipe.papel_alterado',
    'auth.users',
    new.user_id,
    (select o.nome from public.organizations o where o.id = new.organization_id),
    jsonb_build_object(
      'papel', jsonb_build_object('de', old.role, 'para', new.role),
      'pela_arkefit', public.has_role(_ator, 'admin_arke') or public.has_role(_ator, 'superadmin'),
      'pela_api', true
    )
  );
  return new;
end;
$$;

comment on function public.auditar_troca_de_papel() is
  'Registra na auditoria a troca de papel de um vínculo feita com sessão de usuário (direto pela API). A troca pela função editar-membro-equipe é registrada pela função.';

drop trigger if exists trg_auditar_troca_de_papel on public.organization_members;
create trigger trg_auditar_troca_de_papel
  after update of role on public.organization_members
  for each row
  when (old.role is distinct from new.role)
  execute function public.auditar_troca_de_papel();

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.auditar_troca_de_papel() from public, anon, authenticated;
