-- Importação de dieta em PDF via Google Gemini (edge function
-- parse-dieta-pdf) — substitui a extração anterior (Anthropic, desabilitada
-- por custo) por um schema mais rico: cada refeição passa a ter uma lista
-- de itens estruturados (alimento/quantidade/substituições), não só um
-- resumo em texto livre. Mantemos as colunas de texto/macros existentes
-- para não quebrar dietas já publicadas nem a entrada manual.

alter table public.modelo_dieta_refeicoes
  add column itens_estruturados jsonb;

alter table public.modelos_dieta
  add column observacoes text;

alter table public.dietas
  add column observacoes_gerais text;

-- Controle diário do aluno passa a registrar também quais itens
-- individuais (não só quais refeições inteiras) foram consumidos, para a
-- tela de dieta oferecer checkbox por alimento quando a refeição tiver
-- itens estruturados. Formato: { "<ordem_refeicao>": [<indice_item>, ...] }.
alter table public.registro_habito
  add column itens_consumidos jsonb not null default '{}'::jsonb;

create or replace function public.publicar_dieta(
  _aluno_id uuid,
  _modelo_id uuid,
  _titulo text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  _organization_id uuid;
  _snapshot jsonb;
  _observacoes text;
  _dieta_id uuid;
begin
  select organization_id into _organization_id from public.alunos where id = _aluno_id;
  if _organization_id is null then
    raise exception 'Aluno não encontrado';
  end if;

  select observacoes into _observacoes from public.modelos_dieta where id = _modelo_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordem', ordem,
        'nome_refeicao', nome_refeicao,
        'horario_sugerido', horario_sugerido,
        'itens', itens,
        'itens_estruturados', itens_estruturados,
        'calorias_kcal', calorias_kcal,
        'proteinas_g', proteinas_g,
        'carboidratos_g', carboidratos_g,
        'gorduras_g', gorduras_g
      ) order by ordem
    ),
    '[]'::jsonb
  )
  into _snapshot
  from public.modelo_dieta_refeicoes
  where modelo_id = _modelo_id;

  insert into public.dietas (
    organization_id, aluno_id, titulo, snapshot_conteudo, observacoes_gerais, publicado_por
  )
  values (
    _organization_id, _aluno_id, _titulo, _snapshot, _observacoes, auth.uid()
  )
  returning id into _dieta_id;

  return _dieta_id;
end;
$$;
