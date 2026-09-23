-- Canal do mentor ARKE: o chat do aluno pago com a ArkeFit.
--
-- Decisão de 23/09/2026. No Método ARKE quem conduz a jornada é um mentor da
-- ArkeFit, não o professor nem a nutricionista da academia. A academia segue
-- dona do treino e da dieta que presta; a mentoria é o produto da ArkeFit, e é
-- ela que responde por ele.
--
-- **A academia não lê este canal.** Isso não é detalhe de permissão, é o
-- desenho: o aluno fala com o mentor sobre o que não contaria ao professor da
-- academia — desânimo, dificuldade financeira, conflito com a equipe local. Um
-- canal que a academia lê é um canal onde essas coisas não são ditas, e aí ele
-- não serve para nada. Por isso a regra de leitura aqui não tem
-- `is_org_staff`, ao contrário de `mensagens_treino` e `mensagens_dieta`.
--
-- Por ora o mentor é a ArkeFit inteira (`admin_arke` ou `superadmin`),
-- respondendo por uma fila na Visão Master. Atribuir um mentor específico a
-- cada aluno é o passo seguinte e cabe numa coluna `mentor_id` — deixada de
-- fora agora porque um campo que ninguém preenche é pior do que um campo que
-- ainda não existe.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'remetente_mentor') then
    create type public.remetente_mentor as enum ('aluno', 'mentor');
  end if;
end $$;

create table if not exists public.mensagens_mentor (
  id uuid primary key default gen_random_uuid(),
  -- A organização do aluno. Fica aqui pela regra 1 do projeto e porque a
  -- ArkeFit precisa saber de qual academia é o aluno ao atender a fila —
  -- mas, repita-se, ela não dá acesso de leitura à academia.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  remetente_id uuid not null references auth.users(id) on delete cascade,
  remetente_tipo public.remetente_mentor not null,
  mensagem text not null check (length(btrim(mensagem)) between 1 and 4000),
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_mensagens_mentor_aluno on public.mensagens_mentor (aluno_id, created_at desc);
create index if not exists idx_mensagens_mentor_nao_lidas on public.mensagens_mentor (lida, created_at desc) where not lida;
create index if not exists idx_mensagens_mentor_org on public.mensagens_mentor (organization_id);

alter table public.mensagens_mentor enable row level security;

-- Uma regra por operação. Os dois lados legítimos: o aluno dono da conversa e
-- a ArkeFit. Nada de `is_org_staff` — ver o comentário do topo.
create policy "leitura" on public.mensagens_mentor for select to authenticated
using (
  exists (select 1 from public.alunos a
           where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
);

-- Quem escreve tem de ser quem diz ser: o aluno só manda como 'aluno', a
-- ArkeFit só como 'mentor'. Sem isso, um aluno poderia forjar uma mensagem
-- "do mentor" na própria conversa e usá-la como prova depois.
create policy "inclusão" on public.mensagens_mentor for insert to authenticated
with check (
  remetente_id = (select auth.uid())
  and (
    (remetente_tipo = 'aluno'
      and exists (select 1 from public.alunos a
                   where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid())))
    or (remetente_tipo = 'mentor'
      and (public.has_role((select auth.uid()), 'admin_arke')
        or public.has_role((select auth.uid()), 'superadmin')))
  )
);

-- Alteração existe só para marcar como lida. O conteúdo não se edita: uma
-- conversa de acompanhamento que pode ser reescrita depois não serve como
-- registro do que foi orientado.
create policy "alteração" on public.mensagens_mentor for update to authenticated
using (
  exists (select 1 from public.alunos a
           where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
)
with check (
  exists (select 1 from public.alunos a
           where a.id = mensagens_mentor.aluno_id and a.user_id = (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin_arke')
  or public.has_role((select auth.uid()), 'superadmin')
);

create or replace function public.proteger_conteudo_mensagem_mentor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.mensagem is distinct from old.mensagem
     or new.remetente_id is distinct from old.remetente_id
     or new.remetente_tipo is distinct from old.remetente_tipo
     or new.aluno_id is distinct from old.aluno_id then
    raise exception 'Mensagem do mentor não pode ser editada; só a marca de lida muda.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_conteudo_mensagem_mentor() from public, anon, authenticated;

drop trigger if exists trg_proteger_conteudo_mensagem_mentor on public.mensagens_mentor;
create trigger trg_proteger_conteudo_mensagem_mentor
  before update on public.mensagens_mentor
  for each row execute function public.proteger_conteudo_mensagem_mentor();

-- Sem política de DELETE, de propósito: conversa de acompanhamento é registro.

comment on table public.mensagens_mentor is
  'Chat do aluno do Método ARKE com o mentor da ArkeFit. A academia NÃO lê este canal — é o que permite ao aluno falar do que não contaria à equipe local.';

-- A fila que a Visão Master atende: uma linha por aluno, com a última mensagem
-- e quantas esperam resposta. Restrita à ArkeFit, que confere o papel por
-- dentro como as demais `get_superadmin_*`.
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
   -- Esperando resposta primeiro; entre elas, a mais antiga na frente, que é
   -- quem está esperando há mais tempo.
   order by (coalesce(pendentes.total, 0) > 0) desc,
            case when coalesce(pendentes.total, 0) > 0 then ultima.created_at end asc,
            ultima.created_at desc;
end;
$$;

revoke execute on function public.get_superadmin_fila_mentor() from public, anon;
grant execute on function public.get_superadmin_fila_mentor() to authenticated;
