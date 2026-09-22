-- Rodada 1 dos ajustes do sócio (comparação com o app original): app do aluno
-- e comunicação com a equipe.

-- 1) Adesão à dieta por refeição. O aluno marca Sim/Não em cada refeição do
-- plano e o percentual sai disso (src/lib/adesaoDieta.ts). Chave = `ordem` da
-- refeição no snapshot da dieta, que é imutável por versão.
alter table public.dieta_adesao
  add column if not exists refeicoes_marcadas jsonb not null default '{}'::jsonb;

alter table public.dieta_adesao
  drop constraint if exists dieta_adesao_refeicoes_marcadas_objeto,
  add constraint dieta_adesao_refeicoes_marcadas_objeto check (jsonb_typeof(refeicoes_marcadas) = 'object');

comment on column public.dieta_adesao.refeicoes_marcadas is
  'Marcação do aluno por refeição do plano: {"<ordem>": true|false}. adesao_percentual é calculado a partir dela (refeição sem resposta conta como não seguida).';

-- 2) Meta de água: a função pegava UM cadastro de aluno do usuário (select into
-- sem critério). Quem é aluno de duas academias tem dois cadastros, e só um
-- recebia a meta — a armadilha do vínculo duplo. A meta é da pessoa: vale para
-- todos os cadastros dela.
create or replace function public.atualizar_meta_agua_aluno(_meta_ml integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if _meta_ml is null or _meta_ml < 500 or _meta_ml > 8000 then
    raise exception 'Meta de água deve estar entre 500ml e 8000ml.';
  end if;

  update public.alunos set meta_agua_ml = _meta_ml where user_id = auth.uid();
  if not found then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;
end;
$function$;

-- 3) Observações da equipe sobre o aluno — o "prontuário" do app original.
-- Nota interna: o aluno não vê. Sem alteração depois de escrita, para o
-- histórico não ser reescrito; quem escreveu (ou o gestor) pode apagar.
create table if not exists public.aluno_observacoes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  autor_id        uuid references auth.users(id) on delete set null,
  texto           text not null check (length(btrim(texto)) between 1 and 4000),
  created_at      timestamptz not null default now()
);

create index if not exists idx_aluno_observacoes_aluno on public.aluno_observacoes (aluno_id, created_at desc);
create index if not exists idx_aluno_observacoes_org on public.aluno_observacoes (organization_id);
create index if not exists idx_aluno_observacoes_autor on public.aluno_observacoes (autor_id);

alter table public.aluno_observacoes enable row level security;

create policy leitura on public.aluno_observacoes for select to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'admin_arke'));

create policy "inclusão" on public.aluno_observacoes for insert to authenticated
  with check (
    autor_id = (select auth.uid())
    and public.is_org_staff((select auth.uid()), organization_id)
    and exists (select 1 from public.alunos a where a.id = aluno_id and a.organization_id = aluno_observacoes.organization_id)
  );

create policy "exclusão" on public.aluno_observacoes for delete to authenticated
  using (
    autor_id = (select auth.uid())
    or public.has_org_role((select auth.uid()), organization_id, 'gestor')
  );

comment on table public.aluno_observacoes is
  'Observações internas da equipe sobre o aluno (o aluno não vê). Aparecem no histórico da ficha.';

-- 4) Caixa de mensagens da equipe: uma linha por conversa (aluno + canal), com
-- a última mensagem e quantas do aluno ainda não foram lidas. Antes o chat só
-- aparecia abrindo a ficha de cada aluno, e mensagem nova não avisava ninguém.
-- dieta_id: a conversa de nutrição é por dieta; a equipe abre a da última
-- mensagem. Nulo no canal de treino.
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

-- 5) Histórico do aluno na ficha: tudo o que aconteceu com ele, numa linha do
-- tempo. Antes a ficha mostrava só as pendências abertas; o que foi resolvido,
-- com o desfecho, não aparecia em lugar nenhum — o ciclo "Motivo → ... →
-- Desfecho" existia no banco e sumia da vista.
create or replace function public.get_historico_aluno(_aluno_id uuid, _limite integer default 100)
returns table (
  ocorrido_em timestamptz,
  tipo text,
  titulo text,
  detalhe text,
  autor text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
begin
  select a.organization_id into v_org from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;
  if not (public.is_org_staff(auth.uid(), v_org) or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  return query
  select * from (
    -- Atendimento aberto (motivo) ...
    select t.created_at, 'atendimento_aberto'::text, 'Pendência aberta: ' || t.motivo, t.acao,
           (select p.full_name from public.profiles p where p.user_id = t.responsavel_id)
      from public.tarefas t where t.aluno_id = _aluno_id
    union all
    -- ... e o desfecho, quando houve.
    select t.updated_at, 'atendimento_resolvido', 'Resolvida: ' || t.motivo, t.desfecho_acao,
           (select p.full_name from public.profiles p where p.user_id = t.responsavel_id)
      from public.tarefas t where t.aluno_id = _aluno_id and t.status in ('concluida', 'cancelada')
    union all
    select c.created_at, 'checkin',
           case c.status
             when 'funcionando_bem' then 'Check-in: funcionando bem'
             when 'preciso_ajuste' then 'Check-in: precisa de ajuste'
             when 'com_dificuldade' then 'Check-in: com dificuldade'
             else 'Check-in: quer falar com alguém'
           end
           || coalesce(' (' || replace(c.motivo_dificuldade::text, '_', ' ') || ')', ''),
           c.comentario, null::text
      from public.checkins c where c.aluno_id = _aluno_id
    union all
    select h.created_at, 'fase', 'Fase da jornada: ' || coalesce(h.fase_anterior::text || ' → ', '') || h.fase_nova::text,
           h.observacao, h.movido_por_nome
      from public.aluno_fase_historico h where h.aluno_id = _aluno_id
    union all
    select g.created_at, 'agendamento', 'Agendamento (' || g.status::text || ') para ' || to_char(g.data, 'DD/MM/YYYY'), null, null
      from public.agendamentos g where g.aluno_id = _aluno_id
    union all
    select o.created_at, 'observacao', 'Observação da equipe', o.texto,
           (select p.full_name from public.profiles p where p.user_id = o.autor_id)
      from public.aluno_observacoes o where o.aluno_id = _aluno_id
    union all
    select tr.created_at, 'treino_publicado', 'Treino publicado: ' || tr.titulo, null,
           (select p.full_name from public.profiles p where p.user_id = tr.publicado_por)
      from public.treinos tr where tr.aluno_id = _aluno_id
    union all
    select d.created_at, 'dieta_publicada', 'Dieta publicada: ' || d.titulo, null,
           (select p.full_name from public.profiles p where p.user_id = d.publicado_por)
      from public.dietas d where d.aluno_id = _aluno_id
  ) h
  order by 1 desc
  limit least(greatest(coalesce(_limite, 100), 1), 500);
end;
$$;

revoke execute on function public.get_historico_aluno(uuid, integer) from public, anon;
grant execute on function public.get_historico_aluno(uuid, integer) to authenticated;
