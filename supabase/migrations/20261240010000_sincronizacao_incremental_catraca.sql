-- Sincronização incremental do cache da catraca (23/09/2026).
--
-- Cada Gateway baixava a lista INTEIRA de alunos a cada 5 minutos — 75 KB numa
-- academia de 500 alunos, 8.640 vezes por mês: 633 MB de tráfego por academia
-- por mês, quase todo o tráfego da plataforma e 59% das chamadas de função com
-- 100 academias. Quase sempre para receber a mesma lista de 5 minutos antes.
--
-- Agora o Gateway pede só o que mudou desde a última sincronização, e confere
-- o resultado por um hash do conjunto de alunos. Três armadilhas decidiram o
-- desenho:
--
-- 1. **A tolerância vence com o tempo, sem nenhuma linha mudar.** O
--    inadimplente pode entrar por 5 dias a partir da marcação; no sexto,
--    passa a ser barrado sem que `alunos` seja tocada. Um "só o que mudou"
--    por `updated_at` deixaria entrar quem já deveria ser barrado. Por isso a
--    regra passa a poder ser avaliada em qualquer momento
--    (`situacao_permite_app_em`), e a sincronização inclui quem mudou de
--    veredito entre a última sincronização e agora.
--
-- 2. **Exclusão não deixa rastro.** Aluno excluído some da tabela, então não
--    aparece em "o que mudou". O hash do conjunto resolve: depois de aplicar a
--    diferença, o Gateway calcula o hash do próprio cache; se não bater com o
--    da nuvem, pede a lista inteira. Qualquer divergência se corrige sozinha,
--    inclusive as que ninguém previu.
--
-- 3. **Quem deixou de poder estar no cache também é mudança.** Revogar a
--    biometria apaga o identificador; anonimizar apaga o CPF. A linha muda
--    (`updated_at`) e volta na diferença marcada para remoção.

-- ── A regra de acesso, avaliável em qualquer momento ─────────────────────
--
-- `situacao_permite_app` continua com a mesma assinatura e o mesmo resultado:
-- agora só delega para a versão com momento explícito. Os 5 dias continuam
-- escritos num lugar só.
create or replace function public.situacao_permite_app_em(
  _situacao public.situacao_aluno_academia,
  _desde timestamptz,
  _momento timestamptz
)
returns boolean
language sql
stable
as $$
  select _situacao = 'em_dia'
      or (_situacao = 'inadimplente' and coalesce(_desde, _momento) > _momento - interval '5 days');
$$;

create or replace function public.situacao_permite_app(_situacao public.situacao_aluno_academia, _desde timestamptz)
returns boolean
language sql
stable
as $$
  select public.situacao_permite_app_em(_situacao, _desde, now());
$$;

comment on function public.situacao_permite_app_em(public.situacao_aluno_academia, timestamptz, timestamptz) is
  'A regra de acesso (em dia; inadimplente ate 5 dias da marcacao) avaliada num momento qualquer. E o que deixa a sincronizacao incremental achar quem mudou de veredito so pela passagem do tempo.';

-- ── Quem pode estar no cache ─────────────────────────────────────────────
--
-- Tem CPF ou número no equipamento, e não foi anonimizado. Sem nenhuma das
-- duas chaves não há como validar offline; anonimizado não pode estar em
-- lugar nenhum. A mesma definição serve à lista, à diferença e ao hash — se
-- as três divergissem, o hash nunca bateria.
create or replace function public.aluno_elegivel_catraca(_cpf text, _identificador text, _anonimizado_em timestamptz)
returns boolean
language sql
immutable
as $$
  select _anonimizado_em is null
     and (coalesce(nullif(btrim(_cpf), ''), nullif(btrim(_identificador), '')) is not null);
$$;

/**
 * Os alunos para o cache da catraca.
 *
 * `_desde` nulo: a lista inteira dos elegíveis. Com `_desde`: só quem mudou
 * desde então — pelo aluno, pelo perfil (nome, CPF) ou pelo veredito de
 * acesso, que muda sozinho quando a tolerância vence. Na diferença, quem
 * deixou de ser elegível volta com `remover = true`.
 */
create or replace function public.alunos_catraca(_organization_id uuid, _desde timestamptz default null)
returns table(
  aluno_id uuid,
  cpf text,
  identificador_catraca text,
  nome text,
  inadimplente boolean,
  remover boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id,
         coalesce(regexp_replace(p.cpf, '\D', '', 'g'), ''),
         a.identificador_catraca,
         coalesce(p.full_name, ''),
         -- "inadimplente" é o nome do contrato com os gateways instalados; o
         -- sentido é "não entra" (pausado ou inadimplente fora da tolerância).
         not public.situacao_permite_app(a.situacao_academia, a.situacao_academia_em),
         not public.aluno_elegivel_catraca(p.cpf, a.identificador_catraca, a.anonimizado_em)
    from public.alunos a
    left join public.profiles p on p.user_id = a.user_id
   where a.organization_id = _organization_id
     and (
       -- Lista inteira: só os elegíveis.
       (_desde is null and public.aluno_elegivel_catraca(p.cpf, a.identificador_catraca, a.anonimizado_em))
       or
       -- Diferença: mudou algo, ou o veredito mudou pela passagem do tempo.
       (_desde is not null and (
          a.updated_at >= _desde
          or p.updated_at >= _desde
          or public.situacao_permite_app_em(a.situacao_academia, a.situacao_academia_em, _desde)
             is distinct from public.situacao_permite_app_em(a.situacao_academia, a.situacao_academia_em, now())
       ))
     );
$$;

/**
 * Impressão digital do conjunto de elegíveis: md5 dos ids em ordem.
 *
 * Ordenado pelo uuid (comparação de bytes), que coincide com a ordem
 * lexicográfica do texto canônico em minúsculas — é o que deixa o Gateway
 * calcular o mesmo hash com um simples sort() de strings, sem depender de
 * collation.
 */
create or replace function public.alunos_catraca_hash(_organization_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select md5(coalesce(string_agg(a.id::text, ',' order by a.id), ''))
    from public.alunos a
    left join public.profiles p on p.user_id = a.user_id
   where a.organization_id = _organization_id
     and public.aluno_elegivel_catraca(p.cpf, a.identificador_catraca, a.anonimizado_em);
$$;

revoke execute on function public.alunos_catraca(uuid, timestamptz) from public;
revoke execute on function public.alunos_catraca_hash(uuid) from public;
grant execute on function public.alunos_catraca(uuid, timestamptz) to service_role;
grant execute on function public.alunos_catraca_hash(uuid) to service_role;
