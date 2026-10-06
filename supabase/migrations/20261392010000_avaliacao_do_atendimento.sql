-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A avaliação do atendimento (06/10/2026).
--
-- O formulário de habilitação do BaaS do Asaas pergunta se a empresa avalia
-- a qualidade do atendimento prestado aos clientes de forma regular, e o
-- prestador tem de acompanhar a qualidade do atendimento da tomadora (art.
-- 16 da Resolução Conjunta BCB/CMN nº 16/2025). O ARKE não tinha nada disso.
--
-- O atendimento com uma pessoa do outro lado é o chamado de suporte
-- (`chamados_suporte`): a gestão ou a equipe da academia pergunta à Central
-- de Ajuda, o assistente não resolve, e a ArkeFit responde e encerra com o
-- desfecho. Quando o chamado se encerra, quem o abriu vê "Como foi o
-- atendimento?", de 1 a 5, com um comentário opcional. A média e o volume dos
-- últimos 30 dias ficam no Suporte da Visão Master.
--
-- O aluno não abre chamado com a ArkeFit: o pedido de ajuda dele vai à
-- academia, pela fila de atendimento dela.

create table if not exists public.avaliacoes_atendimento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chamado_id uuid not null unique references public.chamados_suporte(id) on delete cascade,
  -- Quem avaliou é quem abriu o chamado. Sem chave estrangeira: a nota fica
  -- quando a pessoa sai, e é a média que importa.
  user_id uuid not null,
  nota smallint not null check (nota between 1 and 5),
  comentario text check (comentario is null or char_length(comentario) <= 1000),
  created_at timestamptz not null default now()
);

comment on table public.avaliacoes_atendimento is
  'Avaliação do atendimento de um chamado de suporte encerrado, por quem o abriu: nota de 1 a 5 e comentário opcional. Gravada só por avaliar_atendimento().';

create index if not exists idx_avaliacoes_atendimento_data on public.avaliacoes_atendimento (created_at desc);
create index if not exists idx_avaliacoes_atendimento_org on public.avaliacoes_atendimento (organization_id, created_at desc);

alter table public.avaliacoes_atendimento enable row level security;
revoke all on public.avaliacoes_atendimento from anon, authenticated;
grant select on public.avaliacoes_atendimento to authenticated;
grant all on public.avaliacoes_atendimento to service_role;

-- Uma regra por operação: a leitura. Quem avaliou vê a própria nota (é o que
-- tira o pedido da tela); a ArkeFit lê todas, e o `has_role` dela só vale com
-- as duas etapas. Ninguém grava pela API: só `avaliar_atendimento()`.
drop policy if exists "leitura" on public.avaliacoes_atendimento;
create policy "leitura" on public.avaliacoes_atendimento
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'superadmin'::app_role)
    or public.has_role((select auth.uid()), 'admin_arke'::app_role)
  );

-- Avalia o chamado encerrado, uma vez. Recebe o id do chamado, então confere
-- quem chama: só quem abriu o chamado, fora de perfil simulado (lá, quem
-- clica é a ArkeFit, e ela não avalia o próprio atendimento).
create or replace function public.avaliar_atendimento(_chamado_id uuid, _nota integer, _comentario text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_dono uuid;
  v_concluido timestamptz;
  v_responsavel uuid;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if public.sessao_simulada() then
    raise exception 'Em perfil simulado, só a própria pessoa avalia o atendimento.' using errcode = '42501';
  end if;
  if _nota is null or _nota < 1 or _nota > 5 then
    raise exception 'A nota vai de 1 a 5.' using errcode = '22023';
  end if;
  if _comentario is not null and char_length(_comentario) > 1000 then
    raise exception 'O comentário vai até 1.000 caracteres.' using errcode = '22023';
  end if;

  select c.organization_id, c.user_id, c.concluido_em, c.responsavel_id
    into v_org, v_dono, v_concluido, v_responsavel
    from public.chamados_suporte c
   where c.id = _chamado_id;
  if not found or v_dono is distinct from v_uid then
    -- Para quem não abriu o chamado, não dizer que ele existe.
    raise exception 'Chamado não encontrado.' using errcode = 'P0002';
  end if;
  if v_concluido is null then
    raise exception 'O chamado ainda está aberto: a avaliação vem depois da resposta.' using errcode = '22023';
  end if;
  if v_responsavel is null then
    raise exception 'Este chamado foi encerrado sem atendimento de uma pessoa.' using errcode = '22023';
  end if;

  insert into public.avaliacoes_atendimento (organization_id, chamado_id, user_id, nota, comentario)
  values (v_org, _chamado_id, v_uid, _nota, nullif(btrim(coalesce(_comentario, '')), ''));
exception
  when unique_violation then
    raise exception 'Este atendimento já foi avaliado.' using errcode = '23505';
end;
$$;

revoke execute on function public.avaliar_atendimento(uuid, integer, text) from public, anon;
grant execute on function public.avaliar_atendimento(uuid, integer, text) to authenticated;

-- Os números do Suporte da Visão Master: média, volume e as notas mais
-- recentes, no período. Só a ArkeFit (o `has_role` exige as duas etapas).
create or replace function public.get_superadmin_avaliacoes_atendimento(_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(coalesce(_dias, 30), 1));
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'avaliacoes', (select count(*) from public.avaliacoes_atendimento a where a.created_at > v_desde),
    'media', (select round(avg(a.nota)::numeric, 2) from public.avaliacoes_atendimento a where a.created_at > v_desde),
    -- Os chamados com uma pessoa do outro lado que se encerraram no período: a taxa de resposta.
    'encerrados', (select count(*) from public.chamados_suporte c
                    where c.concluido_em > v_desde and c.user_id is not null and c.responsavel_id is not null),
    'por_nota', (select coalesce(jsonb_object_agg(n::text, coalesce(q, 0)), '{}'::jsonb)
                   from generate_series(1, 5) n
                   left join (select a.nota, count(*) q from public.avaliacoes_atendimento a
                               where a.created_at > v_desde group by a.nota) t on t.nota = n),
    'recentes', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
                   from (select a.nota, a.comentario, a.created_at, o.nome as organizacao
                           from public.avaliacoes_atendimento a
                           join public.organizations o on o.id = a.organization_id
                          where a.created_at > v_desde
                          order by a.created_at desc
                          limit 10) r)
  );
end;
$$;

revoke execute on function public.get_superadmin_avaliacoes_atendimento(integer) from public, anon;
grant execute on function public.get_superadmin_avaliacoes_atendimento(integer) to authenticated;
