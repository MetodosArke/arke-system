-- Método ARKE, fases 4 e 5: a conversa e o que o aluno vê (28/09/2026).
--
-- Com o mentor dono do acompanhamento, o aluno do Método conversa sobre
-- treino e dieta com ele, e não com a academia. O app já trancava o canal
-- antigo do lado do aluno; faltava o banco, a caixa de mensagens da academia e
-- o aluno saber quem é o mentor dele e quem prescreveu o que ele segue.

-- ---------------------------------------------------------------------------
-- 1. Treino e dieta do aluno do Método não se conversam com a academia
-- ---------------------------------------------------------------------------
--
-- Vale para os dois lados e para qualquer caminho: o aluno não escreve no
-- canal antigo, e a equipe da academia não responde por ele. O histórico
-- continua legível: é o registro do que já foi orientado.
create or replace function public.recusar_conversa_de_prescricao_no_metodo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.equipe_metodo()
     and exists (select 1 from public.alunos a where a.id = new.aluno_id and a.metodo_arke_status = 'ativo') then
    raise exception 'Este aluno está no Método ARKE: treino e dieta se conversam com o mentor, no canal do Método.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_mensagens_treino_metodo
  before insert on public.mensagens_treino
  for each row execute function public.recusar_conversa_de_prescricao_no_metodo();

create trigger trg_mensagens_dieta_metodo
  before insert on public.mensagens_dieta
  for each row execute function public.recusar_conversa_de_prescricao_no_metodo();

revoke execute on function public.recusar_conversa_de_prescricao_no_metodo() from public, anon, authenticated;

-- A caixa de mensagens da academia deixa de listar o aluno do Método: a
-- conversa dele é com o mentor, e uma mensagem antiga não lida ficaria ali
-- para sempre, pedindo uma resposta que a academia não pode mais dar.
create or replace function public.get_caixa_mensagens(_organization_id uuid)
returns table(aluno_id uuid, aluno_nome text, canal text, dieta_id uuid, ultima_mensagem text, ultima_em timestamp with time zone, ultimo_remetente text, nao_lidas bigint, plano text)
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
         coalesce(pe.n, 0), public.plano_do_aluno(a.metodo_arke_status, a.nivel_atacado)
    from ultima u
    join public.alunos a on a.id = u.aluno_id
    left join public.profiles p on p.user_id = a.user_id
    left join pendentes pe on pe.aluno_id = u.aluno_id and pe.canal = u.canal
   where a.metodo_arke_status <> 'ativo'
   order by coalesce(pe.n, 0) > 0 desc,
            u.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. O aluno vê quem é o mentor e quem prescreveu
-- ---------------------------------------------------------------------------
--
-- O aluno não lê `profiles` de outras pessoas nem `equipe_arkefit`, e não deve:
-- aqui ele recebe só o nome do mentor e o nome e o registro de quem assinou o
-- treino e a dieta que ele segue.
create or replace function public.get_meu_acompanhamento(_aluno_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos%rowtype;
begin
  select * into v_aluno from public.alunos where id = _aluno_id and user_id = auth.uid();
  if v_aluno.id is null then
    raise exception 'Cadastro de aluno não encontrado.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'no_metodo', v_aluno.metodo_arke_status = 'ativo',
    'mentor_nome', (select nullif(btrim(p.full_name), '') from public.profiles p where p.user_id = v_aluno.mentor_id),
    'treino', (
      select jsonb_build_object('dono', t.dono, 'registro', t.prescritor_registro,
                                'prescritor', (select nullif(btrim(p.full_name), '') from public.profiles p where p.user_id = t.publicado_por))
        from public.treinos t where t.aluno_id = v_aluno.id and t.status = 'ativo'
       order by t.created_at desc limit 1
    ),
    'dieta', (
      select jsonb_build_object('dono', d.dono, 'registro', d.prescritor_registro,
                                'prescritor', (select nullif(btrim(p.full_name), '') from public.profiles p where p.user_id = d.publicado_por))
        from public.dietas d where d.aluno_id = v_aluno.id and d.status = 'ativo'
       order by d.created_at desc limit 1
    )
  );
end;
$$;

revoke execute on function public.get_meu_acompanhamento(uuid) from public, anon;
grant execute on function public.get_meu_acompanhamento(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A meta semanal do aluno, que não gravava
-- ---------------------------------------------------------------------------
--
-- O calendário do aluno gravava a meta de dias de treino com UPDATE direto em
-- `alunos`, onde o aluno só tem leitura: o PostgREST respondia sucesso com
-- zero linhas e a meta nunca mudava. Passa a ser uma função, como a meta de
-- água, e pela mesma razão recusa o aluno do Método: ali a meta é do mentor.
create or replace function public.atualizar_meta_semanal_aluno(_dias integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _dias is null or _dias < 1 or _dias > 7 then
    raise exception 'A meta de treino deve ficar entre 1 e 7 dias por semana.' using errcode = '22023';
  end if;
  if exists (select 1 from public.alunos a where a.user_id = auth.uid() and a.metodo_arke_status = 'ativo') then
    raise exception 'No Método ARKE a sua meta de treino é definida pelo seu mentor. Fale com ele pelo chat.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Todos os cadastros da pessoa: quem é aluno de duas academias tem uma meta só.
  update public.alunos set meta_semanal_dias = _dias where user_id = auth.uid();
  if not found then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;
end;
$$;

revoke execute on function public.atualizar_meta_semanal_aluno(integer) from public, anon;
grant execute on function public.atualizar_meta_semanal_aluno(integer) to authenticated;
