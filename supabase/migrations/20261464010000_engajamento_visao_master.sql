-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- O engajamento na Visão Master (pedido do Jean, 12/11/2026): a Pontuação ARKE
-- (20261463010000) e o uso do app de cada academia, num período.
--
-- Duas leituras, separadas pelo que mostram:
--   * get_superadmin_engajamento: os números de cada academia, sem nome de
--     aluno. É da carteira (Suporte, Comercial e Financeiro também veem), como a
--     lista de academias;
--   * get_superadmin_pontos_alunos: o ranking dos alunos de uma academia, com o
--     nome. É dado de aluno, então é só do Sócio.
--
-- Entra quem não foi anonimizado e não está pausado: o pausado não treina por
-- combinação, e contar ele derrubaria a academia sem motivo. O período vai até
-- um ano, como em pontos_arke.

create or replace function public.get_superadmin_engajamento(_de date, _ate date)
returns table (
  organization_id uuid,
  nome text,
  alunos bigint,
  treinaram bigint,
  com_checkin bigint,
  desafios_concluidos bigint,
  pontos_total bigint,
  pontos_media numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.acesso_arkefit('carteira') then
    raise exception 'Sem acesso ao engajamento das academias.' using errcode = '42501';
  end if;
  if _de is null or _ate is null or _ate < _de or _ate - _de > 366 then
    raise exception 'Período inválido (até um ano).' using errcode = '22023';
  end if;

  -- ponytail: a conta roda aluno por aluno (pontos_arke_calcular); com dezenas de
  -- milhares de alunos, trocar por uma conta em lote ou por um resumo diário.
  return query
  with al as (
    select a.id, a.organization_id
      from public.alunos a
     where a.anonimizado_em is null
       and a.situacao_academia is distinct from 'pausado'
  ),
  p as (
    select al.organization_id, al.id, pa.constancia, pa.checkins, pa.total,
           (select count(*) from public.desafio_progresso dp
              join public.desafios ds on ds.id = dp.desafio_id
             where dp.aluno_id = al.id and dp.concluido
               and coalesce(dp.concluido_em::date, ds.data_fim) between _de and _ate) as desafios
      from al
      cross join lateral public.pontos_arke_calcular(al.id, _de, _ate) pa
  )
  select o.id, o.nome,
         count(p.id),
         count(p.id) filter (where p.constancia > 0),
         count(p.id) filter (where p.checkins > 0),
         coalesce(sum(p.desafios), 0)::bigint,
         coalesce(sum(p.total), 0)::bigint,
         round(avg(p.total), 1)
    from public.organizations o
    left join p on p.organization_id = o.id
   group by o.id, o.nome
   order by round(avg(p.total), 1) desc nulls last, o.nome;
end;
$function$;
revoke execute on function public.get_superadmin_engajamento(date, date) from public, anon;
grant execute on function public.get_superadmin_engajamento(date, date) to authenticated;

create or replace function public.get_superadmin_pontos_alunos(_organization_id uuid, _de date, _ate date)
returns table (
  aluno_id uuid,
  nome text,
  constancia integer,
  checkins integer,
  desafios integer,
  total integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'superadmin'::public.app_role) then
    raise exception 'Só o Sócio vê os pontos de cada aluno.' using errcode = '42501';
  end if;
  if _de is null or _ate is null or _ate < _de or _ate - _de > 366 then
    raise exception 'Período inválido (até um ano).' using errcode = '22023';
  end if;

  return query
  select a.id, coalesce(pr.full_name, '—'), pa.constancia, pa.checkins, pa.desafios, pa.total
    from public.alunos a
    left join public.profiles pr on pr.user_id = a.user_id
    cross join lateral public.pontos_arke_calcular(a.id, _de, _ate) pa
   where a.organization_id = _organization_id
     and a.anonimizado_em is null
     and a.situacao_academia is distinct from 'pausado'
   order by pa.total desc, 2;
end;
$function$;
revoke execute on function public.get_superadmin_pontos_alunos(uuid, date, date) from public, anon;
grant execute on function public.get_superadmin_pontos_alunos(uuid, date, date) to authenticated;
