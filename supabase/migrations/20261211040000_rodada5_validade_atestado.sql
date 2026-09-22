-- A regra de alteração deixa o aluno atualizar o próprio PAR-Q (refazer as
-- respostas, anexar o atestado). A validade do atestado, não: é a equipe que
-- confere o documento e diz até quando vale — senão o aluno se dava um
-- atestado válido sozinho e o alerta de vencimento nunca disparava.
create or replace function public.proteger_validade_atestado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or public.is_org_staff(auth.uid(), new.organization_id) then
    if new.atestado_validade is distinct from old.atestado_validade then
      new.atestado_registrado_por := auth.uid();
      new.atestado_registrado_em := now();
    end if;
    return new;
  end if;
  if new.atestado_validade is distinct from old.atestado_validade
     or new.atestado_registrado_por is distinct from old.atestado_registrado_por
     or new.atestado_registrado_em is distinct from old.atestado_registrado_em then
    raise exception 'A validade do atestado é registrada pela equipe da academia.' using errcode = '42501';
  end if;
  -- Atestado novo enviado pelo aluno: a validade anterior não vale para ele.
  if new.atestado_caminho is distinct from old.atestado_caminho then
    new.atestado_validade := null;
    new.atestado_registrado_por := null;
    new.atestado_registrado_em := null;
  end if;
  return new;
end;
$$;

create trigger trg_proteger_validade_atestado
  before update on public.aluno_parq
  for each row execute function public.proteger_validade_atestado();
