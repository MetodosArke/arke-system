-- A dor e o esforço do fim do treino só com quem atende a saúde (16/10/2026).
--
-- O que estava errado: no fim do treino o aluno responde o esforço (1 a 10) e
-- como se sentiu, com "Senti dor". As duas respostas moram em
-- `registro_treino` (`esforco_percebido` e `sensacao`, 20261218010000), cuja
-- leitura usa `is_org_staff`, que inclui a recepção. E o carimbo da
-- progressão suspensa por dor (`progressao_bloqueada_em` e
-- `progressao_bloqueada_motivo`, 20261225010000) mora em `alunos`, que a
-- recepção também lê. A regra do produto é "a recepção não vê saúde, nem
-- pela API", e a Política de 10/10 já trata sono, energia, dor e esforço como
-- dado de saúde. Achado em 16/10, na sugestão de progressão (#418).
--
-- O desenho é o de 10/10 para o sono e a energia
-- (20261442010000_sono_e_energia_no_fim_do_treino.sql): coluna não tem regra
-- própria no RLS, então o dado de saúde mora numa tabela à parte, com a
-- leitura de quem atende a saúde (`atende_saude`, sem a recepção), do próprio
-- aluno e da mentoria no aluno do Método.
--
--   1. O esforço e a sensação vão para `registro_treino_bem_estar`, que já
--      tem exatamente essa leitura, uma linha por treino, sem `aluno_id`, e
--      sai em cascata com o treino. Uma tabela nova repetiria a mesma regra.
--      `registro_treino` fica com o que não é saúde: a data, a divisão, o
--      concluído e a duração, que a recepção e o calendário continuam lendo.
--   2. A progressão suspensa vai para `aluno_progressao_bloqueada`, uma linha
--      por aluno enquanto a progressão estiver suspensa (liberar apaga a
--      linha). Não cabe em `registro_treino_bem_estar`, que é por treino, nem
--      em `anamnese_acolhimento`, que no Método a academia não lê (e o
--      professor da academia vê hoje a fase parada por dor do aluno do
--      Método). A leitura é a mesma do bem-estar, e ninguém grava pela API:
--      só o gatilho da dor e `liberar_progressao_aluno`.
--   3. As funções que liam os lugares antigos passam a ler os novos, e
--      `get_jornada_aluno`, que a recepção chama pela ficha do aluno, deixa
--      de dizer a ela que o aluno parou por dor.
--
-- A passagem, sem quebrar a tela publicada: esta migration cria os lugares
-- novos, copia o que existe e move o gatilho da dor. Enquanto o app antigo
-- estiver no ar ele ainda grava o esforço e a sensação em `registro_treino`;
-- um gatilho da janela copia para o lugar novo, e é dele que sai a tarefa da
-- dor. As colunas antigas de `registro_treino` e `alunos.progressao_bloqueada_em`
-- saem na migration pós-deploy, `20261453010000`.
--
-- O carimbo em `alunos` é esvaziado aqui mesmo, e não na pós-deploy: depois
-- desta migration nenhuma função o lê, e esvaziá-lo já fecha essa parte da
-- brecha. Na janela, a sugestão de progressão do app antigo deixa de ver a
-- suspensão mais velha que 7 dias (a dor dos últimos 7 dias ela continua
-- vendo pela sensação). `alunos.progressao_bloqueada_motivo` fica, vazio e
-- sem ninguém que grave: o Sentinela (congelado) o lê, e a coluna sai com a
-- correção dele.

set lock_timeout = '5s';

-- Sem gravação em `registro_treino` até o fim desta migration: o que o app
-- antigo gravasse entre a cópia e o gatilho da janela ficaria fora do lugar
-- novo. A leitura continua.
lock table public.registro_treino in share row exclusive mode;

-- ── 1. O esforço e a sensação, ao lado do sono e da energia ────────────────
alter table public.registro_treino_bem_estar
  add column if not exists esforco_percebido smallint
    check (esforco_percebido is null or esforco_percebido between 1 and 10),
  add column if not exists sensacao text
    check (sensacao is null or sensacao in ('otimo', 'bom', 'regular', 'dificil', 'dor'));

comment on column public.registro_treino_bem_estar.esforco_percebido is
  'Escala de esforço percebido (RPE) de 1 a 10, respondida ao concluir o treino. Dado de saúde: fora de registro_treino, que a recepção lê (20261452010000).';
comment on column public.registro_treino_bem_estar.sensacao is
  'Como o aluno se sentiu no treino; ''dor'' suspende a progressão e abre a tarefa crítica (bloquear_progressao_por_dor). Dado de saúde (20261452010000).';

-- A cópia do que já existe. Antes do gatilho da dor, de propósito: a dor
-- antiga já abriu a tarefa dela, e o carimbo de quem já foi liberado não pode
-- voltar.
insert into public.registro_treino_bem_estar (registro_treino_id, organization_id, esforco_percebido, sensacao)
select r.id, r.organization_id, r.esforco_percebido, r.sensacao
  from public.registro_treino r
 where r.esforco_percebido is not null or r.sensacao is not null
on conflict (registro_treino_id) do update
   set esforco_percebido = excluded.esforco_percebido,
       sensacao = excluded.sensacao;

-- ── 2. A progressão suspensa, fora de `alunos` ─────────────────────────────
create table if not exists public.aluno_progressao_bloqueada (
  aluno_id uuid primary key references public.alunos(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bloqueada_em timestamptz not null default now(),
  motivo text not null
);

create index if not exists idx_aluno_progressao_bloqueada_org on public.aluno_progressao_bloqueada (organization_id);

comment on table public.aluno_progressao_bloqueada is
  'Progressão de fase e de carga suspensa por relato de dor: uma linha por aluno até alguém liberar (liberar_progressao_aluno apaga). O tempo sozinho não desfaz. Dado de saúde, fora de alunos (20261452010000).';

alter table public.aluno_progressao_bloqueada enable row level security;

-- Só a leitura: a linha nasce no gatilho da dor e sai na liberação, nas duas
-- funções `security definer`, e na saída do aluno.
create policy "leitura" on public.aluno_progressao_bloqueada for select to authenticated
using (
  exists (select 1 from public.alunos a
           where a.id = aluno_progressao_bloqueada.aluno_id
             and a.user_id = (select auth.uid()))
  or public.atende_saude(organization_id)
  or ((select public.equipe_metodo()) and public.aluno_no_metodo(aluno_id))
);

-- Dado de pessoa: as duas etapas da gestão valem aqui também (20261363010000).
drop policy if exists "duas etapas" on public.aluno_progressao_bloqueada;
create policy "duas etapas" on public.aluno_progressao_bloqueada as restrictive for all to authenticated
  using ((select public.sessao_cumpre_duas_etapas()))
  with check ((select public.sessao_cumpre_duas_etapas()));

-- O carimbo de hoje vem para cá. O do aluno anonimizado não: a saída já
-- apagou o motivo, e a data sozinha ficou por esquecimento.
insert into public.aluno_progressao_bloqueada (aluno_id, organization_id, bloqueada_em, motivo)
select a.id, a.organization_id, a.progressao_bloqueada_em,
       coalesce(nullif(btrim(a.progressao_bloqueada_motivo), ''), 'Relato de dor no registro de treino')
  from public.alunos a
 where a.progressao_bloqueada_em is not null
   and a.anonimizado_em is null
on conflict (aluno_id) do nothing;

update public.alunos
   set progressao_bloqueada_em = null,
       progressao_bloqueada_motivo = null
 where progressao_bloqueada_em is not null
    or progressao_bloqueada_motivo is not null;

comment on column public.alunos.progressao_bloqueada_em is
  'Vazia desde 20261452010000 (a progressão suspensa mora em aluno_progressao_bloqueada). Sai na pós-deploy 20261453010000.';
comment on column public.alunos.progressao_bloqueada_motivo is
  'Vazia desde 20261452010000, e ninguém grava: a progressão suspensa mora em aluno_progressao_bloqueada, que a recepção não lê. Fica porque o Sentinela (mentor-sugerir-resposta, congelado) a lê; sai com a correção dele.';

-- ── 3. O "Senti dor" no lugar novo ────────────────────────────────────────
--
-- O texto de 20261225010000, lendo de `registro_treino_bem_estar`: a linha
-- não tem `aluno_id`, que vem do treino. A origem da tarefa continua sendo o
-- id do treino, e a mesma dor não abre duas tarefas. O carimbo não volta para
-- a frente: a data é a do primeiro relato.
drop trigger if exists trg_bloquear_progressao_por_dor on public.registro_treino;

create or replace function public.bloquear_progressao_por_dor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _aluno uuid;
  _org_aluno uuid;
  _org_treino uuid;
begin
  if new.sensacao is distinct from 'dor' then
    return new;
  end if;

  select r.aluno_id, a.organization_id, r.organization_id
    into _aluno, _org_aluno, _org_treino
    from public.registro_treino r
    join public.alunos a on a.id = r.aluno_id
   where r.id = new.registro_treino_id;
  if _aluno is null then
    return new;
  end if;

  insert into public.aluno_progressao_bloqueada (aluno_id, organization_id, motivo)
  values (_aluno, _org_aluno, 'Relato de dor no registro de treino')
  on conflict (aluno_id) do nothing;

  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  values (
    _org_treino, _aluno,
    'Aluno relatou dor ao registrar o treino — progressão suspensa',
    'critica',
    now() + interval '12 hours',
    'dor_treino:' || new.registro_treino_id::text,
    'dor'
  )
  on conflict (organization_id, origem_evento) do nothing;

  return new;
end;
$$;

-- ── 4. A janela: o app antigo grava em `registro_treino` ──────────────────
--
-- Copia o esforço e a sensação para o lugar novo, e é de lá que sai a tarefa
-- da dor. Sai na pós-deploy, com as colunas. Treino aberto sem resposta
-- nenhuma (a execução cria o registro na entrada) não ganha linha vazia.
create or replace function public.copiar_dor_e_esforco_da_janela()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.esforco_percebido is null and new.sensacao is null
     and not exists (select 1 from public.registro_treino_bem_estar b where b.registro_treino_id = new.id) then
    return new;
  end if;

  insert into public.registro_treino_bem_estar (registro_treino_id, organization_id, esforco_percebido, sensacao)
  values (new.id, new.organization_id, new.esforco_percebido, new.sensacao)
  on conflict (registro_treino_id) do update
     set esforco_percebido = excluded.esforco_percebido,
         sensacao = excluded.sensacao
   where (registro_treino_bem_estar.esforco_percebido, registro_treino_bem_estar.sensacao)
         is distinct from (excluded.esforco_percebido, excluded.sensacao);

  return new;
end;
$$;

drop trigger if exists trg_copiar_dor_e_esforco_da_janela on public.registro_treino;
create trigger trg_copiar_dor_e_esforco_da_janela
  after insert or update of esforco_percebido, sensacao on public.registro_treino
  for each row execute function public.copiar_dor_e_esforco_da_janela();

drop trigger if exists trg_bloquear_progressao_por_dor on public.registro_treino_bem_estar;
create trigger trg_bloquear_progressao_por_dor
  after insert or update of sensacao on public.registro_treino_bem_estar
  for each row execute function public.bloquear_progressao_por_dor();

-- Função de gatilho nasce com EXECUTE para o PUBLIC (e o Supabase dá à API).
revoke execute on function public.bloquear_progressao_por_dor() from public, anon, authenticated;
revoke execute on function public.copiar_dor_e_esforco_da_janela() from public, anon, authenticated;

-- ── 5. As funções que liam os lugares antigos ─────────────────────────────

-- O texto de 20261226010000, com a suspensão lida da tabela nova. Só a
-- service role a chama (20261275010000); a tela pergunta por get_jornada_aluno.
create or replace function public.motivo_nao_avanca(_aluno_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when a.metodo_arke_status is distinct from 'ativo' then 'fora_do_metodo'
           when a.situacao_academia is distinct from 'em_dia' then 'situacao_' || a.situacao_academia::text
           when exists (select 1 from public.aluno_progressao_bloqueada p where p.aluno_id = a.id) then 'dor'
           -- Inércia: o conceito diz que o avanço é suspenso, não que o aluno
           -- regride. Quem sumiu não colhe progresso de um período em que não
           -- apareceu, e o caso vai para o Mentor em vez de andar sozinho.
           when coalesce(public.aluno_dias_inativo(a.id), 0) >= 5 then 'inercia'
           else null
         end
    from public.alunos a
   where a.id = _aluno_id;
$$;

-- O texto de 20261423010000, com duas mudanças:
--   * a dor é saúde: quem passa só por ser da equipe (a recepção) recebe o
--     motivo vazio, como a tarefa de dor que ela não lê (20261398010000). A
--     ficha mostra a ela "Em evolução dentro da fase";
--   * o aluno sem conta (`user_id` nulo) fazia `v_user = auth.uid()` dar
--     nulo, e `not (... or null)` não recusava ninguém: qualquer pessoa logada
--     lia a jornada dele. O `coalesce` fecha.
create or replace function public.get_jornada_aluno(_aluno_id uuid)
returns table (motivo text, elegivel public.fase_jornada, constancia numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_user uuid;
  v_metodo boolean;
  v_ve_saude boolean;
  v_motivo text;
begin
  select a.organization_id, a.user_id, a.metodo_arke_status = 'ativo' into v_org, v_user, v_metodo
    from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  v_ve_saude := public.atende_saude(v_org)
                or public.acesso_arkefit('socio')
                or public.has_role(auth.uid(), 'admin_arke')
                or (v_metodo and public.acesso_arkefit('mentoria'))
                or coalesce(v_user = auth.uid(), false);
  if not (v_ve_saude or public.is_org_staff(auth.uid(), v_org)) then
    raise exception 'Acesso restrito à equipe da academia.' using errcode = '42501';
  end if;

  v_motivo := public.motivo_nao_avanca(_aluno_id);
  return query select case when v_motivo = 'dor' and not v_ve_saude then null else v_motivo end,
                      public.fase_elegivel(_aluno_id),
                      public.aluno_constancia(_aluno_id, 4);
end;
$$;

-- O texto de 20261423010000, com a linha apagada na tabela nova. Na academia,
-- quem libera passa a ser quem atende a saúde (`atende_saude`): a recepção não
-- vê o relato de dor, e liberar é decidir sobre ele.
create or replace function public.liberar_progressao_aluno(_aluno_id uuid, _observacao text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _org uuid;
  _metodo boolean;
begin
  select organization_id, metodo_arke_status = 'ativo' into _org, _metodo from public.alunos where id = _aluno_id;
  if _org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null
     and not (public.acesso_arkefit('socio')
              or public.has_role(auth.uid(), 'admin_arke')
              or (_metodo and public.equipe_metodo())
              or (public.atende_saude(_org) and not _metodo)) then
    if _metodo then
      raise exception 'Este aluno está no Método ARKE: quem libera a progressão é o mentor da ArkeFit.' using errcode = '42501';
    end if;
    raise exception 'Só quem atende a saúde do aluno, ou a ArkeFit, libera a progressão.' using errcode = '42501';
  end if;
  delete from public.aluno_progressao_bloqueada where aluno_id = _aluno_id;
  insert into public.aluno_observacoes (organization_id, aluno_id, autor_id, texto)
  values (_org, _aluno_id, auth.uid(), coalesce(nullif(trim(_observacao), ''), 'Progressão liberada após avaliação do relato de dor.'));
end;
$function$;

-- O texto de 20261293010000, com a suspensão lida da tabela nova.
create or replace function public.get_carteira_mentor(_limite integer default 500)
returns table (
  aluno_id uuid,
  aluno_nome text,
  organization_id uuid,
  organizacao_nome text,
  plano text,
  fase public.fase_jornada,
  mentor_id uuid,
  mentor_nome text,
  situacao_academia text,
  dias_inativo integer,
  constancia numeric,
  anamnese_concluida boolean,
  treino_ativo boolean,
  treino_validade_fim date,
  dieta_ativa boolean,
  progressao_bloqueada boolean,
  chamados_abertos bigint,
  chamados_atrasados bigint,
  nao_lidas bigint,
  atencao text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.equipe_metodo() then
    raise exception 'Apenas a ArkeFit acessa a carteira do Método.' using errcode = '42501';
  end if;

  return query
  with base as (
    select a.id, a.organization_id, a.user_id, a.metodo_arke_status, a.nivel_atacado, a.fase_jornada,
           a.mentor_id, a.situacao_academia::text as situacao, pb.bloqueada_em as progressao_bloqueada_em
      from public.alunos a
      left join public.aluno_progressao_bloqueada pb on pb.aluno_id = a.id
     where a.metodo_arke_status = 'ativo' and a.anonimizado_em is null
  ),
  sinais as (
    select b.*,
           exists (select 1 from public.anamnese_acolhimento an where an.aluno_id = b.id and an.concluida_em is not null) as tem_anamnese,
           t.id is not null as tem_treino,
           t.validade_fim,
           exists (select 1 from public.dietas d where d.aluno_id = b.id and d.status = 'ativo') as tem_dieta,
           (select count(*) from public.tarefas tf
             where tf.aluno_id = b.id and tf.dono = 'arkefit' and tf.status in ('aberta', 'em_andamento')) as abertos,
           (select count(*) from public.tarefas tf
             where tf.aluno_id = b.id and tf.dono = 'arkefit' and tf.status in ('aberta', 'em_andamento')
               and tf.sla_prazo < now()) as atrasados,
           (select count(*) from public.mensagens_mentor m
             where m.aluno_id = b.id and m.remetente_tipo = 'aluno' and not m.lida) as pendentes
      from base b
      left join lateral (
        select tr.id, tr.validade_fim from public.treinos tr
         where tr.aluno_id = b.id and tr.status = 'ativo'
         order by tr.created_at desc limit 1
      ) t on true
  ),
  marcados as (
    select s.*,
           array_remove(array[
             case when not s.tem_anamnese then 'anamnese' end,
             case when s.tem_anamnese and not s.tem_treino then 'sem_treino' end,
             case when s.tem_anamnese and not s.tem_dieta then 'sem_dieta' end,
             case when s.progressao_bloqueada_em is not null then 'dor' end,
             case when s.atrasados > 0 then 'chamado_atrasado' end,
             case when s.pendentes > 0 then 'mensagem' end,
             case when s.validade_fim is not null and s.validade_fim <= current_date + 7 then 'treino_vencendo' end,
             case when s.mentor_id is null then 'sem_mentor' end
           ], null) as flags
      from sinais s
  ),
  ordenados as (
    select m.*
      from marcados m
     order by
       -- O que trava o aluno vem antes do que só pede atenção.
       (not m.tem_anamnese or not m.tem_treino or m.progressao_bloqueada_em is not null or m.atrasados > 0) desc,
       cardinality(m.flags) desc,
       m.pendentes desc
     limit greatest(coalesce(_limite, 500), 1)
  )
  select o.id,
         coalesce(p.full_name, 'Aluno'),
         o.organization_id,
         org.nome,
         public.plano_do_aluno(o.metodo_arke_status, o.nivel_atacado),
         o.fase_jornada,
         o.mentor_id,
         coalesce(pm.full_name, um.email)::text,
         o.situacao,
         public.aluno_dias_inativo(o.id),
         public.aluno_constancia(o.id, 4),
         o.tem_anamnese,
         o.tem_treino,
         o.validade_fim,
         o.tem_dieta,
         o.progressao_bloqueada_em is not null,
         o.abertos,
         o.atrasados,
         o.pendentes,
         o.flags
    from ordenados o
    join public.organizations org on org.id = o.organization_id
    left join public.profiles p on p.user_id = o.user_id
    left join public.profiles pm on pm.user_id = o.mentor_id
    left join auth.users um on um.id = o.mentor_id;
end;
$$;

-- O texto de 20261423010000, com a suspensão lida da tabela nova e o esforço
-- e a sensação de cada treino lidos do bem-estar.
create or replace function public.get_ficha_mentor(_aluno_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos%rowtype;
  v jsonb;
  v_socio boolean;
begin
  if not public.equipe_metodo() then
    raise exception 'Apenas a ArkeFit abre a ficha do aluno do Método.' using errcode = '42501';
  end if;
  v_socio := public.acesso_arkefit('socio') or public.has_role(auth.uid(), 'admin_arke');

  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  -- Aluno do Free é da academia: a ficha dele não abre aqui.
  if v_aluno.metodo_arke_status <> 'ativo' then
    raise exception 'Este aluno não está no Método ARKE.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'aluno', jsonb_build_object(
      'id', v_aluno.id,
      'nome', coalesce(p.full_name, 'Aluno'),
      'telefone', p.phone,
      'organization_id', v_aluno.organization_id,
      'organizacao_nome', o.nome,
      'plano', public.plano_do_aluno(v_aluno.metodo_arke_status, v_aluno.nivel_atacado),
      'fase', v_aluno.fase_jornada,
      'fase_desde', public.aluno_fase_desde(v_aluno.id),
      'metodo_desde', v_aluno.metodo_arke_ativado_em,
      'data_nascimento', v_aluno.data_nascimento,
      'situacao_academia', v_aluno.situacao_academia,
      'objetivo', v_aluno.objetivo,
      'meta_semanal_dias', v_aluno.meta_semanal_dias,
      'meta_agua_ml', v_aluno.meta_agua_ml,
      'mentor_id', v_aluno.mentor_id,
      'mentor_nome', coalesce(pm.full_name, um.email),
      'mentor_desde', v_aluno.mentor_desde,
      'progressao_bloqueada_em', pb.bloqueada_em,
      'progressao_bloqueada_motivo', pb.motivo,
      'dias_inativo', public.aluno_dias_inativo(v_aluno.id),
      'constancia', public.aluno_constancia(v_aluno.id, 4)
    ),
    'anamnese', (select to_jsonb(an) - 'organization_id' from public.anamnese_acolhimento an where an.aluno_id = v_aluno.id),
    'treino', (
      select jsonb_build_object('id', t.id, 'titulo', t.titulo, 'validade_inicio', t.validade_inicio,
                                'validade_fim', t.validade_fim, 'snapshot', t.snapshot_conteudo, 'dono', t.dono,
                                'prescritor_registro', t.prescritor_registro, 'publicado_em', t.created_at,
                                'publicado_por', coalesce(pt.full_name, 'equipe'))
        from public.treinos t left join public.profiles pt on pt.user_id = t.publicado_por
       where t.aluno_id = v_aluno.id and t.status = 'ativo'
       order by t.created_at desc limit 1
    ),
    'dieta', (
      select jsonb_build_object('id', d.id, 'titulo', d.titulo, 'snapshot', d.snapshot_conteudo,
                                'observacoes_gerais', d.observacoes_gerais, 'dono', d.dono,
                                'prescritor_registro', d.prescritor_registro, 'publicado_em', d.created_at,
                                'publicado_por', coalesce(pd.full_name, 'equipe'))
        from public.dietas d left join public.profiles pd on pd.user_id = d.publicado_por
       where d.aluno_id = v_aluno.id and d.status = 'ativo'
       order by d.created_at desc limit 1
    ),
    'checkins', coalesce((
      select jsonb_agg(c order by c.created_at desc)
        from (select ck.status, ck.comentario, ck.motivo_dificuldade, ck.data, ck.created_at
                from public.checkins ck where ck.aluno_id = v_aluno.id
               order by ck.created_at desc limit 12) c
    ), '[]'::jsonb),
    'treinos_registrados', coalesce((
      select jsonb_agg(r order by r.data desc)
        from (select rt.data, rt.divisao, rt.concluido, b.sensacao, b.esforco_percebido, rt.duracao_min, rt.observacao
                from public.registro_treino rt
                left join public.registro_treino_bem_estar b on b.registro_treino_id = rt.id
               where rt.aluno_id = v_aluno.id and rt.data >= current_date - 28
               order by rt.data desc limit 40) r
    ), '[]'::jsonb),
    'adesao_dieta', coalesce((
      select jsonb_agg(x order by x.data desc)
        from (select da.data, da.adesao_percentual, da.agua_ml, da.consumiu_doce, da.consumiu_alcool, da.observacoes
                from public.dieta_adesao da
               where da.aluno_id = v_aluno.id and da.data >= current_date - 14
               order by da.data desc) x
    ), '[]'::jsonb),
    'avaliacoes', coalesce((
      select jsonb_agg(av order by av.data_avaliacao desc)
        from (select a2.data_avaliacao, a2.peso_kg, a2.altura_cm, a2.imc, a2.percentual_gordura,
                     a2.musculo_percentual, a2.perim_cintura, a2.perim_abdomen, a2.perim_quadril,
                     a2.dores_relatadas, a2.observacoes, a2.data_proxima_avaliacao
                from public.avaliacoes_fisicas a2 where a2.aluno_id = v_aluno.id
               order by a2.data_avaliacao desc limit 6) av
    ), '[]'::jsonb),
    'chamados', coalesce((
      select jsonb_agg(tk order by tk.sla_prazo)
        from (select tf.id, tf.tipo, tf.motivo, tf.prioridade, tf.status, tf.sla_prazo, tf.dono,
                     tf.sla_prazo < now() as atrasado
                from public.tarefas tf
               where tf.aluno_id = v_aluno.id and tf.status in ('aberta', 'em_andamento', 'aguardando')
                 and (v_socio or tf.dono = 'arkefit' or tf.tipo = 'instrucao_presencial')
               order by tf.sla_prazo limit 20) tk
    ), '[]'::jsonb)
  ) into v
  from public.organizations o
  left join public.profiles p on p.user_id = v_aluno.user_id
  left join public.profiles pm on pm.user_id = v_aluno.mentor_id
  left join auth.users um on um.id = v_aluno.mentor_id
  left join public.aluno_progressao_bloqueada pb on pb.aluno_id = v_aluno.id
  where o.id = v_aluno.organization_id;

  return v;
end;
$$;

-- O texto de 20261450010000: a progressão suspensa sai na anonimização (a
-- linha tem `aluno_id`), e o motivo em `alunos` não é mais tocado (vazio).
create or replace function public.anonimizar_dados_do_aluno(_aluno_id uuid, _ator uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a public.alunos%rowtype;
  v_org_nome text;
  v_cpf text;
  v_outros boolean;
  v_avatar text;
  v_imagens text[];
begin
  select * into a from public.alunos where id = _aluno_id for update;
  if a.id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  if a.anonimizado_em is not null then
    raise exception 'Este aluno já foi anonimizado.' using errcode = 'P0001';
  end if;

  select o.nome into v_org_nome from public.organizations o where o.id = a.organization_id;
  select p.cpf, p.avatar_url into v_cpf, v_avatar from public.profiles p where p.user_id = a.user_id;
  v_outros := public.pessoa_tem_outro_vinculo(_aluno_id);

  -- 1. A marca primeiro: o gatilho tira a digital e o rosto dos equipamentos
  --    e limpa o número da catraca. Depois, o que identifica na ficha.
  update public.alunos
     set anonimizado_em = now(),
         objetivo = null,
         observacoes = null,
         data_nascimento = null,
         altura_cm = null,
         peso_kg = null,
         situacao_academia_motivo = null
   where id = _aluno_id;

  -- 2. Autorizações: revogadas. A revogação da IA apaga o que a IA gerou; o
  --    termo da digital fica como prova.
  update public.aluno_consentimento_ia
     set revogado_em = now(), revogado_por = _ator
   where aluno_id = _aluno_id and revogado_em is null;
  update public.aluno_consentimento_biometrico
     set revogado_em = now(), revogado_por = _ator
   where aluno_id = _aluno_id and revogado_em is null;

  -- 3. Saúde e acompanhamento: o conteúdo sai. Da anamnese fica só a prova
  --    do consentimento (quando e qual versão).
  update public.anamnese_acolhimento
     set rotina_diaria = null, objetivo_principal = null, experiencias_exercicio = null,
         dores_lesoes = null, medicamentos = null, tempo_disponivel = null, estilo_treino = null,
         alimentos_gosta = null, alimentos_nao_gosta = null, alimentacao_rotina = null,
         expectativas = null, qualidade_sono = null, nivel_estresse = null,
         frequencia_semanal_desejada = null
   where aluno_id = _aluno_id;
  delete from public.aluno_parq where aluno_id = _aluno_id;
  delete from public.avaliacoes_fisicas where aluno_id = _aluno_id;
  delete from public.aluno_objetivos where aluno_id = _aluno_id;
  delete from public.aluno_observacoes where aluno_id = _aluno_id;
  delete from public.aluno_valores where aluno_id = _aluno_id;
  delete from public.aluno_rotina_semanal where aluno_id = _aluno_id;
  delete from public.aluno_fase_historico where aluno_id = _aluno_id;
  -- A progressão suspensa por dor (20261452010000).
  delete from public.aluno_progressao_bloqueada where aluno_id = _aluno_id;
  delete from public.checkins where aluno_id = _aluno_id;
  delete from public.compromisso_semanal where aluno_id = _aluno_id;
  delete from public.metricas_customizadas where aluno_id = _aluno_id;
  delete from public.sentinela_anamnese where aluno_id = _aluno_id;
  -- A sugestão ao mentor perde o texto e fica: ela mede o trabalho do mentor,
  -- que é outra pessoa (a mesma regra da revogação, migration 20261231).
  update public.sentinela_sugestoes
     set sugestao = '[removido a pedido do aluno]'
   where aluno_id = _aluno_id and sugestao <> '[removido a pedido do aluno]';
  -- A nota da pesquisa de satisfação fica no NPS, sem o comentário (20261450010000).
  update public.pesquisa_satisfacao
     set comentario = null
   where aluno_id = _aluno_id and comentario is not null;
  delete from public.fotos_rosto_pendentes where aluno_id = _aluno_id;
  delete from public.registro_treino where aluno_id = _aluno_id;
  delete from public.registro_habito where aluno_id = _aluno_id;
  delete from public.treino_calendario where aluno_id = _aluno_id;
  delete from public.treinos where aluno_id = _aluno_id;
  delete from public.dieta_adesao where aluno_id = _aluno_id;
  delete from public.dietas where aluno_id = _aluno_id;
  delete from public.agendamentos where aluno_id = _aluno_id;
  delete from public.desafio_progresso where aluno_id = _aluno_id;
  delete from public.desafio_participantes where aluno_id = _aluno_id;
  delete from public.competicao_participantes where aluno_id = _aluno_id;

  -- 4. As conversas, dos dois lados.
  delete from public.mensagens_treino where aluno_id = _aluno_id;
  delete from public.mensagens_dieta where aluno_id = _aluno_id;
  delete from public.mensagens_mentor where aluno_id = _aluno_id;

  -- 5. O que identifica em registro que fica.
  update public.aluno_assinaturas_contrato
     set nome_digitado = 'Aluno anonimizado', user_agent = null
   where aluno_id = _aluno_id;
  update public.acessos_catraca_logs
     set cpf_consultado = null
   where aluno_id = _aluno_id and cpf_consultado is not null;
  if v_cpf is not null and length(regexp_replace(v_cpf, '\D', '', 'g')) = 11 then
    update public.importacoes_alunos_linhas
       set dados = jsonb_build_object('anonimizado', true), mensagem = null
     where organization_id = a.organization_id
       and (user_id_criado = a.user_id
            or regexp_replace(coalesce(dados ->> 'cpf', ''), '\D', '', 'g') = regexp_replace(v_cpf, '\D', '', 'g'));
  else
    update public.importacoes_alunos_linhas
       set dados = jsonb_build_object('anonimizado', true), mensagem = null
     where organization_id = a.organization_id and user_id_criado = a.user_id;
  end if;

  -- 6. O feed desta academia. As fotos ficam num bucket público: a edge
  --    function apaga os arquivos pela lista devolvida.
  select coalesce(array_agg(fp.image_url) filter (where fp.image_url is not null), '{}')
    into v_imagens
    from public.feed_posts fp
   where fp.user_id = a.user_id and fp.organization_id = a.organization_id;
  delete from public.feed_comments where user_id = a.user_id and organization_id = a.organization_id;
  delete from public.feed_likes where user_id = a.user_id and organization_id = a.organization_id;
  delete from public.feed_posts where user_id = a.user_id and organization_id = a.organization_id;

  -- 7. O vínculo desta academia. Com o vínculo inativo, a equipe daqui deixa
  --    de enxergar o perfil da pessoa (regra de leitura de `profiles`).
  update public.organization_members
     set status = 'inactive'
   where user_id = a.user_id and organization_id = a.organization_id and role = 'aluno';

  -- 8. O perfil é da pessoa. Só é anonimizado quando ela não tem vínculo vivo
  --    em outro lugar; senão, a outra academia perderia o cadastro dela.
  if not v_outros then
    update public.profiles
       set full_name = 'Pessoa anonimizada', cpf = null, phone = null, avatar_url = null,
           cep = null, logradouro = null, endereco_numero = null, complemento = null,
           bairro = null, cidade = null, uf = null, status = 'inactive'
     where user_id = a.user_id;
  end if;

  perform public.registrar_auditoria(
    _ator, 'aluno.anonimizado', 'aluno', _aluno_id, v_org_nome,
    jsonb_build_object('outros_vinculos', v_outros));

  return jsonb_build_object(
    'user_id', a.user_id,
    'organization_id', a.organization_id,
    'outros_vinculos', v_outros,
    'avatar_url', case when v_outros then null else v_avatar end,
    'imagens_feed', to_jsonb(v_imagens));
end;
$$;
