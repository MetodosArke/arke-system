-- Validação de CPF por dígito verificador, no banco.
--
-- Por que no banco e não só na tela: o CPF entra por três caminhos — o
-- formulário da ficha, a importação de base em lote e as edge functions de
-- convite. Validar em cada um deles significa três lugares para esquecer.
-- A tela continua validando (mensagem melhor, erro antes do request), mas
-- quem garante é a constraint.
--
-- O custo de não ter isto já apareceu: na base de homologação, 8 dos 10
-- CPFs cadastrados são sequências inválidas do tipo 123.456.789-01, todas
-- entradas pela importação, que não validava nada. E o CPF é a chave de
-- leitura da catraca — lixo importado hoje vira aluno que não entra na
-- academia daqui a meses, com a recepção sem entender por quê.

create or replace function public.cpf_valido(_cpf text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  c text;
  soma int;
  d1 int;
  d2 int;
  i int;
begin
  c := regexp_replace(coalesce(_cpf, ''), '\D', '', 'g');

  if length(c) <> 11 then
    return false;
  end if;

  -- Sequências repetidas passam no módulo 11 por acidente aritmético e são
  -- o preenchimento improvisado mais comum quando o campo é obrigatório e
  -- quem cadastra não tem o documento em mãos.
  if c ~ '^(.)\1{10}$' then
    return false;
  end if;

  soma := 0;
  for i in 1..9 loop
    soma := soma + substr(c, i, 1)::int * (11 - i);
  end loop;
  d1 := (soma * 10) % 11;
  if d1 >= 10 then d1 := 0; end if;

  soma := 0;
  for i in 1..10 loop
    soma := soma + substr(c, i, 1)::int * (12 - i);
  end loop;
  d2 := (soma * 10) % 11;
  if d2 >= 10 then d2 := 0; end if;

  return d1 = substr(c, 10, 1)::int and d2 = substr(c, 11, 1)::int;
end;
$$;

comment on function public.cpf_valido(text) is
  'Validação de CPF pelo módulo 11 da Receita Federal. Aceita com ou sem pontuação.';

-- NOT VALID de propósito: barra o que entra de agora em diante e deixa as
-- linhas existentes em paz. Validar retroativamente derrubaria a migração
-- por causa dos 8 CPFs inválidos já cadastrados — e transformar limpeza de
-- dado legado em pré-requisito de deploy é como se para de fazer deploy.
-- Quando a base estiver limpa: ALTER TABLE ... VALIDATE CONSTRAINT.
alter table public.profiles
  drop constraint if exists profiles_cpf_valido;

alter table public.profiles
  add constraint profiles_cpf_valido
  check (cpf is null or cpf = '' or public.cpf_valido(cpf))
  not valid;

comment on constraint profiles_cpf_valido on public.profiles is
  'CPF precisa fechar o dígito verificador. NOT VALID: linhas anteriores à migração não foram checadas.';
