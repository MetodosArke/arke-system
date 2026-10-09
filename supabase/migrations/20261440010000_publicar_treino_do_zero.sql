set lock_timeout = '5s';

-- Publicar o treino do zero, sem modelo da biblioteca (09/10/2026).
--
-- Até aqui o professor só publicava a partir de um modelo: para um treino
-- feito sob medida, criava um modelo na biblioteca, montava, publicava e
-- deixava o modelo de um aluno só misturado aos modelos da academia. Agora ele
-- monta os exercícios na própria tela de publicação e publica direto.
--
-- O snapshot é o mesmo de `publicar_treino` (as mesmas chaves, na mesma
-- ordem de divisão e posição) e continua imutável (`trg_treinos_imutavel`).
-- O treino nasce com `modelo_id` nulo.
--
-- Cada item vem do acervo, pelo `exercicio_id`, e o exercício tem de ser do
-- acervo global ou da academia do aluno (a mesma regra do seletor,
-- `exercicioDoEscopo`). O nome, os grupos, o equipamento, o vídeo e o GIF
-- vêm do acervo, e não da tela: assim o vínculo e o nome nunca divergem, e o
-- app acha os GIFs por modelo pelo id (`useGifsDoAcervo`). Da tela vêm só a
-- divisão, as séries, a descrição de execução (vazia: a do acervo) e a
-- observação para o aluno.
--
-- Quem publica. A função roda com a permissão de quem chama, como
-- `publicar_treino`: o RLS de `treinos` e o gatilho do dono
-- (`definir_dono_da_prescricao`) valem do mesmo jeito, e o acervo lido é o que
-- a pessoa enxerga. Por cima, ela confere quem chama, mais estrito que o RLS
-- (que deixa qualquer pessoa da equipe incluir):
--   * aluno fora do Método: o gestor ou o professor da academia do aluno, ou
--     a ArkeFit (`has_role`, com as duas etapas). No painel do autônomo, o
--     gatilho ainda separa treino (personal) de dieta (nutricionista);
--   * aluno do Método: só quem prescreve treino do Método
--     (`pode_prescrever_treino_metodo`: a equipe do Método com CREF; o sócio
--     sem CREF só com a exigência desligada), a regra de hoje.

create or replace function public.publicar_treino_do_zero(
  _aluno_id uuid,
  _titulo text,
  _itens jsonb,
  _validade_inicio date default current_date,
  _validade_fim date default null::date
)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  _organization_id uuid;
  _metodo boolean;
  _snapshot jsonb;
  _treino_id uuid;
  _fora_do_acervo integer;
  _invalidos integer;
begin
  if auth.uid() is null then
    raise exception 'Entre com a sua conta para publicar o treino.' using errcode = '42501';
  end if;

  select a.organization_id, a.metodo_arke_status = 'ativo'
    into _organization_id, _metodo
    from public.alunos a
   where a.id = _aluno_id;
  if _organization_id is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;

  if _metodo then
    if not public.pode_prescrever_treino_metodo() then
      raise exception 'Este aluno está no Método ARKE: o treino é prescrito pela equipe da ArkeFit, por um profissional com CREF.'
        using errcode = '42501';
    end if;
  elsif not (
    public.has_org_role(auth.uid(), _organization_id, 'gestor')
    or public.has_org_role(auth.uid(), _organization_id, 'professor')
    or public.has_role(auth.uid(), 'admin_arke')
  ) then
    raise exception 'Só o professor ou a gestão da academia do aluno publicam o treino.' using errcode = '42501';
  end if;

  if coalesce(btrim(_titulo), '') = '' then
    raise exception 'Dê um título ao treino.' using errcode = '22023';
  end if;
  if _itens is null or jsonb_typeof(_itens) <> 'array' or jsonb_array_length(_itens) = 0 then
    raise exception 'Monte o treino com pelo menos um exercício.' using errcode = '22023';
  end if;
  if jsonb_array_length(_itens) > 150 then
    raise exception 'O treino passa de 150 exercícios: divida em mais de uma publicação.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(_itens) as t(i) where jsonb_typeof(i) <> 'object') then
    raise exception 'Item do treino em formato inválido.' using errcode = '22023';
  end if;

  -- Cada item aponta para um exercício do acervo global ou da academia do
  -- aluno. O `case` vem antes do `::uuid`: texto que não é id vira nulo, e
  -- não erro de conversão.
  select count(*)
    into _fora_do_acervo
    from jsonb_array_elements(_itens) as t(i)
    cross join lateral (
      select case
               when coalesce(i ->> 'exercicio_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then (i ->> 'exercicio_id')::uuid
             end as id
    ) v
   where v.id is null
      or not exists (
        select 1 from public.exercicios_biblioteca e
         where e.id = v.id
           and (e.organization_id is null or e.organization_id = _organization_id)
      );
  if _fora_do_acervo > 0 then
    raise exception 'Cada exercício do treino vem do acervo: o global ou o da academia do aluno.' using errcode = '22023';
  end if;

  -- Divisão de A a J; séries de 1 a 10, como o editor; repetições escritas;
  -- descanso de 0 a 1 hora; o detalhe série a série, quando vem, é uma lista.
  select count(*)
    into _invalidos
    from jsonb_array_elements(_itens) as t(i)
   where coalesce(i ->> 'divisao', 'A') not in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J')
      or coalesce(i ->> 'series', '') !~ '^[0-9]{1,2}$'
      or coalesce(i ->> 'descanso_seg', '') !~ '^[0-9]{1,4}$'
      or coalesce(btrim(i ->> 'repeticoes'), '') = ''
      or length(i ->> 'repeticoes') > 200
      or coalesce(jsonb_typeof(i -> 'series_detalhe'), 'null') not in ('null', 'array')
      or length(coalesce(i ->> 'observacoes', '')) > 1000
      or length(coalesce(i ->> 'descricao_execucao', '')) > 2000;
  -- Só depois de os textos serem números: a conversão não falha.
  if _invalidos = 0 then
    select count(*)
      into _invalidos
      from jsonb_array_elements(_itens) as t(i)
     where (i ->> 'series')::integer not between 1 and 10
        or (i ->> 'descanso_seg')::integer > 3600;
  end if;
  if _invalidos > 0 then
    raise exception 'Confira a divisão, as séries, as repetições e o descanso de cada exercício.' using errcode = '22023';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'ordem', x.ordem,
             'divisao', x.divisao,
             'nome_exercicio', e.nome,
             'grupo_muscular', coalesce(nullif(e.grupos_musculares, '{}'::text[]), array[e.grupo_muscular]),
             'equipamento', e.equipamento,
             'exercicio_id', e.id,
             'series', x.series,
             'repeticoes', x.repeticoes,
             'descanso_seg', x.descanso_seg,
             'series_detalhe', x.series_detalhe,
             'observacoes', x.observacoes,
             'video_url', e.video_url,
             'descricao_execucao', coalesce(x.descricao_execucao, e.descricao_execucao),
             'gif_url', e.gif_url
           ) order by x.divisao, x.ordem
         )
    into _snapshot
    from (
      select (n - 1)::integer as ordem,
             coalesce(i ->> 'divisao', 'A') as divisao,
             (i ->> 'exercicio_id')::uuid as exercicio_id,
             (i ->> 'series')::integer as series,
             btrim(i ->> 'repeticoes') as repeticoes,
             (i ->> 'descanso_seg')::integer as descanso_seg,
             case when jsonb_typeof(i -> 'series_detalhe') = 'array' then i -> 'series_detalhe' end as series_detalhe,
             nullif(btrim(i ->> 'observacoes'), '') as observacoes,
             nullif(btrim(i ->> 'descricao_execucao'), '') as descricao_execucao
        from jsonb_array_elements(_itens) with ordinality as t(i, n)
    ) x
    join public.exercicios_biblioteca e on e.id = x.exercicio_id;

  insert into public.treinos (
    organization_id, aluno_id, modelo_id, titulo, snapshot_conteudo,
    publicado_por, validade_inicio, validade_fim
  )
  values (
    _organization_id, _aluno_id, null, btrim(_titulo), _snapshot,
    auth.uid(), _validade_inicio, _validade_fim
  )
  returning id into _treino_id;

  return _treino_id;
end;
$function$;

revoke execute on function public.publicar_treino_do_zero(uuid, text, jsonb, date, date) from public, anon;
grant execute on function public.publicar_treino_do_zero(uuid, text, jsonb, date, date) to authenticated;
