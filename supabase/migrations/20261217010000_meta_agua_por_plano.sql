-- Quem define a meta de água depende do plano.
--
-- Decisão de 23/09/2026: no **Free** quem define é o próprio aluno; no
-- **Método ARKE** quem define é o mentor, porque lá a hidratação faz parte de
-- um acompanhamento prescrito e não de uma escolha solta. Um aluno que mexe na
-- própria meta no meio de um plano de mentoria desconfigura justamente o que
-- está sendo medido.
--
-- A trava fica na RPC, que é o único caminho pelo qual o aluno grava esse
-- campo: a policy de UPDATE de `alunos` é da equipe, e o aluno só tem SELECT.
-- A tela também esconde o campo, mas é aqui que a regra vale.
--
-- A equipe e a ArkeFit seguem definindo pelo bloco *Metas do Aluno* da ficha,
-- em qualquer plano — é por ali que o mentor age enquanto o painel de mentoria
-- não existe.

create or replace function public.atualizar_meta_agua_aluno(_meta_ml integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_no_metodo boolean;
begin
  if _meta_ml is null or _meta_ml < 500 or _meta_ml > 8000 then
    raise exception 'Meta de água deve estar entre 500ml e 8000ml.';
  end if;

  -- Basta um cadastro no Método para a meta deixar de ser do aluno: quem é
  -- aluno de duas academias e paga o Método numa delas está sob mentoria, e a
  -- meta de hidratação é uma só por pessoa.
  select exists (
    select 1 from public.alunos a
     where a.user_id = auth.uid() and a.metodo_arke_status = 'ativo'
  ) into v_no_metodo;

  if v_no_metodo then
    raise exception 'No Método ARKE a meta de hidratação é definida pelo seu mentor. Fale com ele pelo chat.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Vale para todos os cadastros da pessoa: quem é aluno de duas academias
  -- tem duas linhas legítimas, e a meta de água é da pessoa, não do vínculo.
  update public.alunos set meta_agua_ml = _meta_ml where user_id = auth.uid();
  if not found then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;
end;
$$;

revoke execute on function public.atualizar_meta_agua_aluno(integer) from public, anon;
grant execute on function public.atualizar_meta_agua_aluno(integer) to authenticated;
