-- A senha vazia não é sinal da matrícula pública não confirmada (07/10/2026).
--
-- `apagar_matriculas_publicas_nao_confirmadas` (20261403) só apagava a conta
-- com `encrypted_password` vazio. O Auth, ao criar a conta sem senha, grava o
-- hash de uma senha aleatória que ninguém conhece: a condição nunca casava, e
-- a rotina não apagaria nenhuma matrícula. Achado na corrente real, pela conta
-- criada como a função cria; a prova em transação desfeita criava a conta
-- direto no banco, com a senha vazia, e não viu.
--
-- A condição sai. Quem criou a senha passou pelo link do e-mail, que confirma
-- o e-mail e abre a sessão: `email_confirmed_at` e `last_sign_in_at`, que
-- continuam na seleção, já dizem isso.

set lock_timeout = '5s';

create or replace function public.apagar_matriculas_publicas_nao_confirmadas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_total integer := 0;
begin
  for v in
    select u.id as user_id, a.id as aluno_id, a.organization_id, o.nome as org_nome
      from auth.users u
      join public.alunos a on a.user_id = u.id
      left join public.organizations o on o.id = a.organization_id
     where u.raw_app_meta_data ->> 'origem' = 'matricula_publica'
       and u.email_confirmed_at is null
       and u.last_sign_in_at is null
       and u.created_at < now() - interval '7 days'
       -- Um vínculo só: o aluno da matrícula pública. Quem está em outro lugar fica.
       and not exists (select 1 from public.alunos x where x.user_id = u.id and x.id <> a.id)
       and not exists (
             select 1 from public.organization_members m
              where m.user_id = u.id
                and not (m.organization_id = a.organization_id and m.role = 'aluno'))
       and not exists (select 1 from public.user_roles r where r.user_id = u.id)
       -- Quem já tem número na catraca entra na academia: é aluno de verdade.
       and a.identificador_catraca is null
       -- Nenhum arquivo na pasta do aluno (atestado, termo da digital, vídeo).
       and not exists (
             select 1 from storage.objects so
              where so.name like a.organization_id::text || '/' || a.id::text || '/%')
       -- Por último, a mais cara: nada de outra tabela aponta para o aluno.
       -- No filtro, e não só no laço, para a que fica não ocupar a vez das outras.
       and public.aluno_como_nasceu(a.id)
     order by u.created_at
     limit 100
  loop
    -- Cada uma no próprio bloco: a que falha numa trava que esta função não
    -- conhece fica, e as outras seguem.
    begin
      -- De novo, já dentro do bloco: alguém pode ter registrado algo no aluno
      -- entre a lista e a exclusão.
      if public.conta_da_matricula_publica_nao_confirmada(v.user_id) and public.aluno_como_nasceu(v.aluno_id) then
        delete from public.alunos where id = v.aluno_id;
        delete from public.organization_members
         where user_id = v.user_id and organization_id = v.organization_id and role = 'aluno';
        -- A conta vai junto: as tabelas que apontam para ela apagam ou soltam a linha.
        delete from auth.users where id = v.user_id;
        perform public.registrar_auditoria(
          null, 'matricula_publica.apagada_sem_confirmacao', 'organizations', v.organization_id, v.org_nome,
          jsonb_build_object('dias_sem_confirmacao', 7));
        v_total := v_total + 1;
      end if;
    exception
      -- Falta de permissão não é desta matrícula: é a rotina inteira que não
      -- funciona, e ela tem de aparecer como falha na Visão Master.
      when insufficient_privilege then
        raise;
      when others then
        -- Só o código: a mensagem pode trazer dado da pessoa.
        raise warning 'matrícula pública não confirmada ficou (código %)', sqlstate;
    end;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.apagar_matriculas_publicas_nao_confirmadas() from public, anon, authenticated;
grant execute on function public.apagar_matriculas_publicas_nao_confirmadas() to service_role;
