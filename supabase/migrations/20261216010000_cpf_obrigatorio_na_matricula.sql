-- CPF obrigatório na matrícula do aluno.
--
-- A regra do produto sempre foi essa — matrícula de aluno gera cobrança, e o
-- gateway não emite cobrança sem CPF. O que o código fazia era outra coisa: o
-- CPF era **opcional** em todos os caminhos. A constraint do banco dizia
-- `cpf is null or cpf = '' or cpf_valido(cpf)`, a matrícula pública aceitava o
-- campo ausente, e a ficha do aluno e a importação também. A auditoria de
-- 22/09/2026 chegou a registrar isso como "decisão de não coletar CPF", o que
-- era leitura errada de uma limitação de dado de teste.
--
-- A trava fica em `alunos`, e não em `profiles`, por dois motivos:
--
--   1. `alunos` É a matrícula. É o momento exato em que a regra passa a valer,
--      e não depende de qual tela ou função criou a linha — a trava vale para
--      a matrícula pública, para a ficha do aluno, para a importação e para
--      qualquer caminho futuro que ninguém lembrou de ajustar.
--   2. `profiles` é compartilhado com a equipe. Gestor, professor e
--      nutricionista não são matriculados nem cobrados; exigir CPF deles
--      quebraria o cadastro em lote da equipe sem ganho nenhum.
--
-- Linhas que já existem não são tocadas: o gatilho vale para inclusão e para
-- alteração que mexa no aluno, não para o que está lá. Isso é deliberado — uma
-- base importada antes desta regra não deve sumir do app de um dia para o
-- outro; o CPF entra quando a academia editar a ficha.

create or replace function public.exigir_cpf_na_matricula()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cpf text;
begin
  select p.cpf into v_cpf from public.profiles p where p.user_id = new.user_id;

  if v_cpf is null or btrim(v_cpf) = '' then
    raise exception 'CPF é obrigatório para matricular o aluno. Preencha o CPF no cadastro antes de concluir a matrícula.'
      using errcode = 'check_violation';
  end if;

  -- A validade em si é da constraint `profiles_cpf_valido`; aqui só se garante
  -- que o campo não está vazio. Conferir de novo seria duplicar a regra em
  -- dois lugares que podem divergir.
  return new;
end;
$$;

revoke execute on function public.exigir_cpf_na_matricula() from public, anon, authenticated;

drop trigger if exists trg_exigir_cpf_na_matricula on public.alunos;
create trigger trg_exigir_cpf_na_matricula
  before insert on public.alunos
  for each row execute function public.exigir_cpf_na_matricula();

comment on trigger trg_exigir_cpf_na_matricula on public.alunos is
  'CPF é obrigatório na matrícula: ela gera cobrança e o gateway não emite cobrança sem CPF. Vale para todo caminho de criação — matrícula pública, ficha do aluno, importação —, inclusive service_role.';
