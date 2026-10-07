-- A caixa de mensagens mostra só o que quem pede pode ler (auditoria de
-- prontidão, 06/10/2026).
--
-- `get_caixa_mensagens` (20261295010000) rodava com a permissão da função
-- (`security definer`): conferia se quem chama era da equipe ou `admin_arke`
-- e devolvia todas as conversas de treino e de nutrição da academia. É a
-- mesma classe do histórico do aluno, corrigido em 20261394010000. Conferido
-- contra o RLS das tabelas de origem (`mensagens_treino`, `mensagens_dieta`):
--   * a função pulava a regra restritiva das duas etapas (20261363010000):
--     com o fator cadastrado e a sessão sem a segunda etapa, a gestão lia a
--     caixa inteira, que a API recusa;
--   * o resto ela entregava igual ao RLS, e o RLS da conversa da nutrição
--     estava largo: `is_org_staff` (a recepção inclusive) e o `admin_arke` de
--     qualquer academia. A conversa da nutrição é saúde (a dieta, a alergia, o
--     refluxo), e a dieta já era só de quem atende (`atende_saude()`) e, no
--     Free, não da ArkeFit (20261360010000, blocos 2 e 3). A recepção lia pela
--     caixa e pela API a conversa da nutricionista com o aluno.
--   * a conversa do mentor do Método mora em `mensagens_mentor`, que a
--     academia não lê, e a caixa já tirava o aluno do Método: por aí não há
--     o que corrigir.
--
-- A escolha, no molde do histórico:
--   1. a conversa da nutrição segue a regra da dieta: o aluno; quem atende a
--      saúde na academia (a conversa antiga de quem entrou no Método continua
--      legível para ela, como 20261295010000 decidiu); e a ArkeFit só no
--      aluno do Método. Uma regra só, para todas as operações, como já era: a
--      recepção também deixa de responder por ela;
--   2. a função passa a rodar com a permissão de quem chama (`security
--      invoker`): cada canal é lido pelo RLS da própria tabela, inclusive as
--      duas etapas, e a regra mora num lugar só. Quem chama continua sendo a
--      equipe ou a ArkeFit; o que cada um vê, o RLS decide.
--
-- A conversa de treino fica como está: o treino é lido por toda a equipe e
-- pela ArkeFit (a regra de `treinos`), e a recepção acompanha o chat de treino
-- na caixa. No app, a recepção deixa de ver o canal de nutrição
-- (`canaisDoPapel`).

set lock_timeout = '5s';

alter policy "aluno/staff usa chat de nutrição" on public.mensagens_dieta
  using (
    (exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
    or public.atende_saude(organization_id)
    or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id))
  )
  with check (
    (
      (exists (select 1 from public.alunos a where a.id = mensagens_dieta.aluno_id and a.user_id = (select auth.uid())))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'aluno'::public.remetente_tipo_dieta
    )
    or (
      (public.atende_saude(organization_id) or (public.equipe_metodo() and public.aluno_no_metodo(aluno_id)))
      and remetente_id = (select auth.uid())
      and remetente_tipo = 'nutricionista'::public.remetente_tipo_dieta
    )
  );

create or replace function public.get_caixa_mensagens(_organization_id uuid)
returns table(aluno_id uuid, aluno_nome text, canal text, dieta_id uuid, ultima_mensagem text, ultima_em timestamp with time zone, ultimo_remetente text, nao_lidas bigint, plano text)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
begin
  if not (public.is_org_staff(auth.uid(), _organization_id) or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  -- Cada canal pelo RLS da própria tabela: a recepção não recebe a conversa
  -- da nutrição, e a sessão sem as duas etapas não recebe nada.
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

comment on function public.get_caixa_mensagens(uuid) is
  'Caixa de mensagens da equipe. Roda com a permissão de quem chama (security invoker): cada canal passa pelo RLS da tabela de origem, e a conversa da nutrição fica com quem atende a saúde.';

revoke execute on function public.get_caixa_mensagens(uuid) from public, anon;
grant execute on function public.get_caixa_mensagens(uuid) to authenticated;
