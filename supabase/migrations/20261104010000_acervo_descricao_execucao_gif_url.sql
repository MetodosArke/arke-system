-- Libera o acervo de exercícios para gestor/professor documentarem como
-- executar cada exercício: descrição em texto + GIF (video_url já existia
-- e serve tanto pra vídeo quanto link do YouTube). Os mesmos campos são
-- espelhados em modelo_treino_exercicios (item da ficha-modelo), pra
-- poderem ser pré-preenchidos ao adicionar um exercício da biblioteca
-- numa ficha e fluírem até o snapshot publicado que o app do aluno lê.
alter table public.exercicios_biblioteca
  add column if not exists descricao_execucao text,
  add column if not exists gif_url text;

alter table public.modelo_treino_exercicios
  add column if not exists descricao_execucao text,
  add column if not exists gif_url text;

-- publicar_treino: inclui descricao_execucao e gif_url no snapshot
-- imutável, igual já fazia com video_url.
create or replace function public.publicar_treino(
  _aluno_id uuid,
  _modelo_id uuid,
  _titulo text,
  _validade_inicio date default current_date,
  _validade_fim date default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  _organization_id uuid;
  _snapshot jsonb;
  _treino_id uuid;
begin
  select organization_id into _organization_id from public.alunos where id = _aluno_id;
  if _organization_id is null then
    raise exception 'Aluno não encontrado';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordem', ordem,
        'nome_exercicio', nome_exercicio,
        'grupo_muscular', grupo_muscular,
        'series', series,
        'repeticoes', repeticoes,
        'descanso_seg', descanso_seg,
        'observacoes', observacoes,
        'video_url', video_url,
        'descricao_execucao', descricao_execucao,
        'gif_url', gif_url
      ) order by ordem
    ),
    '[]'::jsonb
  )
  into _snapshot
  from public.modelo_treino_exercicios
  where modelo_id = _modelo_id;

  insert into public.treinos (
    organization_id, aluno_id, modelo_id, titulo, snapshot_conteudo,
    publicado_por, validade_inicio, validade_fim
  )
  values (
    _organization_id, _aluno_id, _modelo_id, _titulo, _snapshot,
    auth.uid(), _validade_inicio, _validade_fim
  )
  returning id into _treino_id;

  return _treino_id;
end;
$$;
