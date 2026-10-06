-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- O CPF fica guardado só com os dígitos (06/10/2026).
--
-- Três funções gravam o CPF como ele foi digitado (a matrícula pública, o
-- convite e o cadastro de equipe). A catraca procura o aluno pelo CPF só com
-- os dígitos, e o índice único (`idx_profiles_cpf_unico`, 20261121010000) é
-- sobre o texto cru. Um CPF gravado com a máscara não era achado na catraca,
-- e o mesmo CPF com e sem máscara passava pelo índice como se fossem duas
-- pessoas. Hoje não há nenhum CPF com máscara no banco; a regra fica no
-- banco para valer em qualquer caminho, inclusive os que ainda não existem.
--
-- Só sai a máscara: pontos, traço, barra e espaços. Texto com outra coisa
-- (letra, por exemplo) fica como veio, e a constraint `profiles_cpf_valido`
-- o recusa como antes; tirar tudo que não é dígito transformaria lixo em
-- CPF vazio e o deixaria passar.
--
-- Vale para as duas colunas de CPF de pessoa: `profiles.cpf` e o CPF que a
-- catraca registrou em `acessos_catraca_logs.cpf_consultado`. Fica de fora
-- `organizations.cnpj_cpf`: é o documento da empresa, ninguém procura por
-- ele, e o CNPJ alfanumérico da Receita tem letras, que esta regra apagaria.

create or replace function public.cpf_sem_mascara(_valor text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when _valor is null then null
    -- O traço fica no fim dos colchetes, onde é literal.
    when _valor ~ '^[0-9./[:space:]-]*$' then regexp_replace(_valor, '[^0-9]', '', 'g')
    else _valor
  end;
$$;

comment on function public.cpf_sem_mascara(text) is
  'CPF sem a máscara (pontos, traço, barra, espaços). Texto com outro caractere volta como veio, para a validação recusar.';

create or replace function public.guardar_cpf_sem_mascara()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'profiles' then
    new.cpf := public.cpf_sem_mascara(new.cpf);
  elsif tg_table_name = 'acessos_catraca_logs' then
    new.cpf_consultado := public.cpf_sem_mascara(new.cpf_consultado);
  end if;
  return new;
end;
$$;

revoke execute on function public.guardar_cpf_sem_mascara() from public, anon, authenticated;

drop trigger if exists trg_cpf_sem_mascara on public.profiles;
create trigger trg_cpf_sem_mascara
  before insert or update of cpf on public.profiles
  for each row execute function public.guardar_cpf_sem_mascara();

drop trigger if exists trg_cpf_sem_mascara on public.acessos_catraca_logs;
create trigger trg_cpf_sem_mascara
  before insert or update of cpf_consultado on public.acessos_catraca_logs
  for each row execute function public.guardar_cpf_sem_mascara();

-- O que já está gravado. Hoje é nada; se houver, e se a mesma pessoa estiver
-- com e sem máscara, o índice único recusa e a migration para aqui, que é o
-- certo: duas contas com o mesmo CPF são para uma pessoa olhar, não para a
-- migration escolher.
update public.profiles
   set cpf = public.cpf_sem_mascara(cpf)
 where cpf is not null and cpf is distinct from public.cpf_sem_mascara(cpf);
