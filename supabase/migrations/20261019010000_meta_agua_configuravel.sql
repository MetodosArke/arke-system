-- Meta de consumo de água configurável por aluno (em vez do valor fixo de
-- 2000-3000ml sugerido no texto de ajuda). O aluno ajusta a própria meta
-- via RPC (evita expor UPDATE livre na tabela alunos para o próprio
-- aluno, que hoje só tem SELECT do próprio cadastro).
alter table public.alunos
  add column meta_agua_ml integer not null default 2000
    constraint alunos_meta_agua_ml_check check (meta_agua_ml between 500 and 8000);

create or replace function public.atualizar_meta_agua_aluno(_meta_ml integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _aluno_id uuid;
begin
  if _meta_ml is null or _meta_ml < 500 or _meta_ml > 8000 then
    raise exception 'Meta de água deve estar entre 500ml e 8000ml.';
  end if;

  select id into _aluno_id from public.alunos where user_id = auth.uid();
  if _aluno_id is null then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;

  update public.alunos set meta_agua_ml = _meta_ml where id = _aluno_id;
end;
$$;

revoke execute on function public.atualizar_meta_agua_aluno(integer) from public;
grant execute on function public.atualizar_meta_agua_aluno(integer) to authenticated;
