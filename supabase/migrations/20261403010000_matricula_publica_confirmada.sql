-- A matrícula pública confirmada pelo e-mail (decisão de 07/10/2026).
--
-- Até aqui `matricula-publica` criava a conta com a senha que o visitante
-- digitava e o e-mail já confirmado. Quem fizesse a matrícula com o e-mail e o
-- CPF de outra pessoa ficava com uma conta usável, e a matrícula que outra
-- academia fizesse depois para a pessoa de verdade se ligava a essa conta pelo
-- CPF (`convidar-membro`, decisão de 03/10/2026): o pré-sequestro.
--
-- A função passa a criar a conta sem senha e sem o e-mail confirmado, marcada
-- em `app_metadata.origem = 'matricula_publica'` (só o servidor grava
-- `app_metadata`). A pessoa cria a senha pelo link do e-mail, que é a prova de
-- posse. Sobra a conta que nunca é confirmada: ela não é usável, mas fica
-- ligada à academia do link, com o nome, o telefone e o CPF que alguém digitou.
-- Esta migration trata essa conta:
--
--   1. `conta_da_matricula_publica_nao_confirmada(user_id)`: a regra, num lugar
--      só, para o banco e para `convidar-membro`;
--   2. a conta que veio da matrícula pública e não confirmou o e-mail não
--      recebe matrícula de outra academia (gatilho em `alunos`). Vale para todo
--      caminho que cria aluno, inclusive a versão publicada de
--      `convidar-membro` antes desta regra;
--   3. depois de 7 dias sem confirmação, a matrícula que ficou como nasceu é
--      apagada, com a conta (rotina diária). "Como nasceu": sem outro vínculo,
--      sem número de catraca, sem arquivo e sem nenhuma linha que aponte para o
--      aluno em outra tabela (presença, cobrança, documento, conversa,
--      consentimento...). O que a academia ou a pessoa registrou fica, e a
--      matrícula também.

set lock_timeout = '5s';

-- ── 1. A regra ─────────────────────────────────────────────────────────────
create or replace function public.conta_da_matricula_publica_nao_confirmada(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = _user_id
       and u.raw_app_meta_data ->> 'origem' = 'matricula_publica'
       and u.email_confirmed_at is null
  );
$$;

revoke execute on function public.conta_da_matricula_publica_nao_confirmada(uuid) from public, anon, authenticated;
grant execute on function public.conta_da_matricula_publica_nao_confirmada(uuid) to service_role;

comment on function public.conta_da_matricula_publica_nao_confirmada(uuid) is
  'A conta nasceu na matrícula pública (app_metadata.origem) e o e-mail ainda não foi confirmado pelo link. Só o servidor chama.';

-- ── 2. A outra academia espera a confirmação ───────────────────────────────
-- A conta nova da própria matrícula pública passa (ainda não há aluno em outra
-- academia). A segunda academia é recusada até o dono do e-mail criar a senha
-- pelo link, ou até a rotina abaixo apagar a matrícula não confirmada.
create or replace function public.matricula_publica_sem_outra_academia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.conta_da_matricula_publica_nao_confirmada(new.user_id)
     and exists (
       select 1
         from public.alunos a
        where a.user_id = new.user_id
          and a.organization_id <> new.organization_id
     ) then
    raise exception 'Essa conta veio de uma matrícula online, feita pelo link de outra academia, e o e-mail ainda não foi confirmado. Ela recebe outra matrícula depois que a pessoa criar a senha pelo link do e-mail.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_matricula_publica_sem_outra_academia on public.alunos;
create trigger trg_matricula_publica_sem_outra_academia
  before insert or update of user_id on public.alunos
  for each row execute function public.matricula_publica_sem_outra_academia();

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.matricula_publica_sem_outra_academia() from public, anon, authenticated;

-- ── 3. A matrícula que ficou como nasceu sai em 7 dias ─────────────────────
-- Nenhuma linha de outra tabela aponta para o aluno. Lido do catálogo, e não
-- de uma lista escrita à mão: a tabela nova que apontar para `alunos` passa a
-- segurar a matrícula sem ninguém lembrar desta função.
create or replace function public.aluno_como_nasceu(_aluno_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fk record;
  v_tem boolean;
begin
  for v_fk in
    select c.conrelid::regclass as tabela, a.attname as coluna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.alunos'::regclass
       and array_length(c.conkey, 1) = 1
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_fk.tabela, v_fk.coluna)
      into v_tem
      using _aluno_id;
    if v_tem then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke execute on function public.aluno_como_nasceu(uuid) from public, anon, authenticated;
grant execute on function public.aluno_como_nasceu(uuid) to service_role;

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
       and coalesce(u.encrypted_password, '') = ''
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

comment on function public.apagar_matriculas_publicas_nao_confirmadas() is
  'Apaga a matrícula pública (e a conta) que não confirmou o e-mail em 7 dias e ficou como nasceu. Rotina diária arke-matriculas-nao-confirmadas.';

-- Todo dia às 04:35 de Brasília (o pg_cron agenda em GMT).
select cron.unschedule(jobid) from cron.job where jobname = 'arke-matriculas-nao-confirmadas';
select cron.schedule('arke-matriculas-nao-confirmadas', '35 7 * * *', 'select public.apagar_matriculas_publicas_nao_confirmadas()');
