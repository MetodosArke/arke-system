-- Tetos diários para o que uma pessoa logada grava direto no banco e outras
-- pessoas veem: post e comentário no feed, mensagem de chat, chamado aberto
-- pelo aluno (o alerta, que cai na fila da academia ou do mentor da ArkeFit)
-- e arquivo no Storage.
--
-- Hoje nada limita isso: um laço — com defeito no app ou de propósito —
-- encheria o feed da academia, a caixa de mensagens da equipe e a fila de
-- chamados, e o Storage. Os tetos são folgados: uso de verdade não chega
-- neles; laço chega em minutos.
--
-- Valem só para quem está logado. Rotina e service role (cron, webhook, as
-- edge functions) passam, porque já conferem o que gravam.

-- ── Feed: por pessoa, por dia ───────────────────────────────────────────
create or replace function public.teto_diario_feed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _limite integer := TG_ARGV[0]::integer;
  _n integer;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  execute format('select count(*) from public.%I where user_id = $1 and created_at > now() - interval ''1 day''', TG_TABLE_NAME)
     into _n using new.user_id;
  if _n >= _limite then
    raise exception 'Você já publicou bastante hoje no feed. Amanhã libera de novo.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_teto_diario_feed on public.feed_posts;
create trigger trg_teto_diario_feed before insert on public.feed_posts
  for each row execute function public.teto_diario_feed(30);
drop trigger if exists trg_teto_diario_feed on public.feed_comments;
create trigger trg_teto_diario_feed before insert on public.feed_comments
  for each row execute function public.teto_diario_feed(200);

-- ── Mensagens: por conversa (aluno) e por quem envia, por dia ────────────
-- Por conversa, e não por pessoa: o professor que responde 50 alunos num dia
-- não pode ser barrado; o laço numa conversa só, sim.
create or replace function public.teto_diario_mensagens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _n integer;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  execute format('select count(*) from public.%I where aluno_id = $1 and remetente_id = $2 and created_at > now() - interval ''1 day''', TG_TABLE_NAME)
     into _n using new.aluno_id, new.remetente_id;
  if _n >= 100 then
    raise exception 'Muitas mensagens nesta conversa hoje. Amanhã libera de novo; se for urgente, fale com a recepção.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_teto_diario_mensagens on public.mensagens_treino;
create trigger trg_teto_diario_mensagens before insert on public.mensagens_treino
  for each row execute function public.teto_diario_mensagens();
drop trigger if exists trg_teto_diario_mensagens on public.mensagens_dieta;
create trigger trg_teto_diario_mensagens before insert on public.mensagens_dieta
  for each row execute function public.teto_diario_mensagens();
drop trigger if exists trg_teto_diario_mensagens on public.mensagens_mentor;
create trigger trg_teto_diario_mensagens before insert on public.mensagens_mentor
  for each row execute function public.teto_diario_mensagens();

-- ── Chamado aberto pelo próprio aluno: por aluno, por dia ────────────────
-- O alerta do app vira chamado na fila (da academia, ou do mentor da ArkeFit
-- no Método), com uma referência única a cada envio. A regra de inclusão
-- deixa o aluno criar chamado para si com qualquer referência, então o teto
-- conta todo chamado do aluno nas últimas 24 horas, inclusive os que as
-- rotinas abriram (poucos por dia), sempre que quem grava é o próprio aluno.
-- O nome do gatilho ordena antes de `trg_ultimo_sla_util_mentor`, que
-- precisa ser o último.
create or replace function public.teto_diario_alertas_aluno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _n integer;
begin
  if (select auth.uid()) is null or new.aluno_id is null then
    return new;
  end if;
  if not exists (select 1 from public.alunos a where a.id = new.aluno_id and a.user_id = (select auth.uid())) then
    return new;
  end if;
  select count(*) into _n
    from public.tarefas t
   where t.aluno_id = new.aluno_id
     and t.created_at > now() - interval '1 day';
  if _n >= 15 then
    raise exception 'Você já enviou muitos alertas hoje, e a equipe já foi avisada. Se for urgente, fale com a recepção.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_teto_alertas_aluno on public.tarefas;
create trigger trg_teto_alertas_aluno before insert on public.tarefas
  for each row execute function public.teto_diario_alertas_aluno();

-- Funções de gatilho não ficam expostas no PostgREST.
revoke execute on function public.teto_diario_feed() from public, anon, authenticated;
revoke execute on function public.teto_diario_mensagens() from public, anon, authenticated;
revoke execute on function public.teto_diario_alertas_aluno() from public, anon, authenticated;

-- ── Storage: envios por pasta, por dia ───────────────────────────────────
-- A pasta é o dono: `<user_id>/` no feed e no logo; `<organization_id>/<aluno_id>/`
-- no atestado, no vídeo do chat e no termo da digital. Mídia do acervo é da
-- equipe e fica sem teto aqui.
create or replace function public.envio_dentro_do_teto(_bucket text, _nome text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select case
    when _bucket in ('feed-images', 'avatars') then
      (select count(*) from storage.objects o
        where o.bucket_id = _bucket
          and o.name like split_part(_nome, '/', 1) || '/%'
          and o.created_at > now() - interval '1 day') < 30
    when _bucket in ('chat-videos', 'atestados', 'termos-biometria') then
      (select count(*) from storage.objects o
        where o.bucket_id = _bucket
          and o.name like split_part(_nome, '/', 1) || '/' || split_part(_nome, '/', 2) || '/%'
          and o.created_at > now() - interval '1 day') < 20
    else true
  end;
$$;

-- A regra roda como o usuário logado: sem isto ela daria erro em vez de negar.
revoke execute on function public.envio_dentro_do_teto(text, text) from public, anon;
grant execute on function public.envio_dentro_do_teto(text, text) to authenticated;

-- A regra de envio continua uma só: a condição de antes, e o teto.
alter policy "objetos: inclusão" on storage.objects
  with check (
    (
      (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
      or (bucket_id = 'feed-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
      or (bucket_id = any (array['exercicio-videos', 'exercicio-imagens']) and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
      or (bucket_id = any (array['atestados', 'chat-videos']) and public.pode_acessar_atestado(name))
      or (bucket_id = 'termos-biometria' and public.pode_gravar_termo_biometria(name))
    )
    and public.envio_dentro_do_teto(bucket_id, name)
  );
