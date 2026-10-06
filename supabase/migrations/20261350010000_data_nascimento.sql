set lock_timeout = '5s';

-- Aluno menor de idade, parte 1: a data de nascimento (decisão do
-- responsável, 06/10/2026).
--
-- A Política (art. 14 da LGPD) e os Termos prometiam o consentimento de ao
-- menos um dos pais ou do responsável para o aluno menor de 18 anos, e o
-- sistema não tinha como saber quem é menor: `alunos.data_nascimento` existe
-- desde a fundação, mas nenhum caminho de matrícula a pedia, e nenhum aluno a
-- tem hoje. A decisão: "pedir a data de nascimento. O menor se matricula e
-- treina normalmente, mas saúde, biometria e IA só liberam com o aceite do
-- responsável, por um link enviado ao e-mail dele."
--
-- Esta migration só cuida da data: a conta da idade, a validação e o caminho
-- para o aluno sem data (todos os de hoje) informá-la uma vez no app. O
-- responsável e a trava vêm nas duas seguintes.
--
-- A matrícula nova pede a data na tela e na função (matrícula pública e
-- cadastro pela academia); a importação aceita a planilha sem ela. Por isso a
-- coluna continua aceitando nulo: nulo é "idade desconhecida", e idade
-- desconhecida trava o mesmo que a do menor, até a data vir.

-- ── A idade ─────────────────────────────────────────────────────────────────
-- Completa em `_hoje`. Quem nasceu em 29/02 completa ano em 01/03 nos anos
-- comuns (Código Civil, art. 132, § 3º: falta o dia correspondente, vale o
-- seguinte) — `date + interval '18 years'` daria 28/02, um dia antes. A mesma
-- conta de `idadeEm()` em src/lib/menorDeIdade.ts.
create or replace function public.idade_em(_nascimento date, _hoje date)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
           when _nascimento is null or _hoje is null then null
           else (extract(year from _hoje) - extract(year from _nascimento))::integer
                - case when (extract(month from _hoje), extract(day from _hoje))
                            < (extract(month from _nascimento), extract(day from _nascimento))
                       then 1 else 0 end
         end;
$$;

comment on function public.idade_em(date, date) is
  'Idade completa numa data; 29/02 completa ano em 01/03 nos anos comuns (CC art. 132, § 3º). Espelho de idadeEm() em src/lib/menorDeIdade.ts.';

-- adulto, menor ou desconhecida (sem data). `current_date` já é a data de
-- Brasília, pelo fuso do banco.
create or replace function public.situacao_idade(_nascimento date)
returns text
language sql
stable
set search_path = public
as $$
  select case
           when _nascimento is null then 'desconhecida'
           when public.idade_em(_nascimento, current_date) >= 18 then 'adulto'
           else 'menor'
         end;
$$;

revoke execute on function public.idade_em(date, date) from public, anon;
grant execute on function public.idade_em(date, date) to authenticated, service_role;
revoke execute on function public.situacao_idade(date) from public, anon;
grant execute on function public.situacao_idade(date) to authenticated, service_role;

-- ── A data tem de ser possível ──────────────────────────────────────────────
-- Em todo caminho que grava a data (matrícula, ficha, importação, app): não no
-- futuro e não antes de 1900. As mesmas regras de erroDataNascimento().
create or replace function public.validar_data_nascimento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.data_nascimento is not null
     and (new.data_nascimento < date '1900-01-01' or new.data_nascimento > current_date) then
    raise exception 'Data de nascimento inválida: confira o dia, o mês e o ano.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_data_nascimento on public.alunos;
create trigger trg_validar_data_nascimento
  before insert or update of data_nascimento on public.alunos
  for each row execute function public.validar_data_nascimento();

-- ── Corrigir a data fica registrado ─────────────────────────────────────────
-- A equipe pode corrigir a data na ficha (é ela quem responde pelo cadastro).
-- Mas trocar a data de quem já tinha uma muda quem precisa do aceite do
-- responsável: a troca vai para a auditoria, com a data antiga e a nova.
-- Preencher a data que faltava não é troca e não é registrado; apagar também
-- não (é o que a anonimização faz, e sem data a trava fica mais fechada, não
-- mais aberta).
create or replace function public.registrar_troca_data_nascimento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.data_nascimento is not null and new.data_nascimento is not null
     and new.data_nascimento is distinct from old.data_nascimento then
    insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
    select auth.uid(), u.email, 'aluno.data_nascimento_alterada', 'alunos', new.id, o.nome,
           jsonb_build_object('antes', old.data_nascimento, 'depois', new.data_nascimento)
      from public.organizations o
      left join auth.users u on u.id = auth.uid()
     where o.id = new.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_registrar_troca_data_nascimento on public.alunos;
create trigger trg_registrar_troca_data_nascimento
  after update of data_nascimento on public.alunos
  for each row execute function public.registrar_troca_data_nascimento();

-- ── O aluno sem data informa uma vez, no app ────────────────────────────────
-- O aluno não altera `alunos` (a regra de alteração é da equipe), então a data
-- entra por aqui. "Uma vez": só onde a data falta. Quem já tem data e acha que
-- está errada pede à recepção, que corrige na ficha — e a correção fica na
-- auditoria. Grava em todas as matrículas da pessoa sem data: a data de
-- nascimento é da pessoa, e quem está em duas academias não informa duas vezes.
--
-- Na sessão simulada é recusada: a data decide quem precisa do aceite do
-- responsável, e quem simula não declara pela pessoa.
create or replace function public.informar_data_nascimento(_data date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if public.sessao_simulada() then
    raise exception 'Em perfil simulado, só a própria pessoa informa a data de nascimento. Peça a ela para fazer isso no app dela.'
      using errcode = 'P0001';
  end if;
  if _data is null or _data < date '1900-01-01' or _data > current_date then
    raise exception 'Data de nascimento inválida: confira o dia, o mês e o ano.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.alunos where user_id = v_uid) then
    raise exception 'Cadastro de aluno não encontrado.' using errcode = '42501';
  end if;

  update public.alunos
     set data_nascimento = _data
   where user_id = v_uid
     and data_nascimento is null
     and anonimizado_em is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.informar_data_nascimento(date) is
  'O aluno informa a própria data de nascimento, uma vez (só onde falta). Recusada na sessão simulada.';

revoke execute on function public.informar_data_nascimento(date) from public, anon;
grant execute on function public.informar_data_nascimento(date) to authenticated;

revoke execute on function public.validar_data_nascimento() from public, anon, authenticated;
revoke execute on function public.registrar_troca_data_nascimento() from public, anon, authenticated;
