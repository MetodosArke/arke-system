-- Aplica o limite de alunos do plano B2B.
--
-- `organizations.limite_alunos` existe desde a fundação do schema, com
-- default 150, e nunca foi consultada por linha nenhuma de código — nem no
-- frontend, nem nas edge functions, nem em trigger. Uma academia no plano
-- Starter (150 alunos pelo contrato) importava 500 sem um aviso. Era um
-- limite comercial que o produto vendia e não impunha.
--
-- A garantia fica no banco, e não nas telas, porque aluno entra por quatro
-- caminhos: convite do gestor, auto-matrícula pública, matrícula criada
-- pela academia e importação em lote. Validar em cada um é quatro lugares
-- para esquecer — e o quinto caminho, que ainda não existe, já nasceria
-- furado.

create or replace function public.limite_padrao_plano(_plano public.plano_b2b)
returns integer
language sql
immutable
as $$
  -- Os números do contrato comercial, num lugar só. Custom e autônomo não
  -- têm teto de tabela: são negociados caso a caso, e o valor fica na
  -- própria organização.
  select case _plano
    when 'starter'    then 150
    when 'growth'     then 500
    when 'enterprise' then 1000
    else null
  end;
$$;

comment on function public.limite_padrao_plano(public.plano_b2b) is
  'Teto de alunos previsto em contrato para cada plano B2B. NULL para custom/autonomo, negociados caso a caso.';

create or replace function public.exigir_limite_alunos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite integer;
  v_atuais integer;
  v_plano public.plano_b2b;
begin
  select o.limite_alunos, o.plano_b2b into v_limite, v_plano
    from public.organizations o
   where o.id = new.organization_id;

  if v_limite is null then
    return new;
  end if;

  -- Aluno anonimizado por LGPD não ocupa vaga: ele não usa a plataforma e
  -- continuar contando penalizaria a academia por cumprir a lei.
  select count(*) into v_atuais
    from public.alunos a
   where a.organization_id = new.organization_id
     and a.anonimizado_em is null;

  if v_atuais >= v_limite then
    -- Mensagem endereçada a quem vai ler: a recepção precisa saber o que
    -- fazer, não o nome da constraint.
    raise exception
      'Limite de % alunos do plano % atingido. Para cadastrar mais alunos, fale com a ArkeFit sobre migrar de plano.',
      v_limite, v_plano
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_alunos_limite on public.alunos;
create trigger trg_alunos_limite
  before insert on public.alunos
  for each row execute function public.exigir_limite_alunos();

-- Leitura do consumo para as telas: quanto da cota já foi usada. Sem isto,
-- o gestor só descobre o limite no momento em que ele barra alguém.
create or replace function public.obter_uso_limite_alunos()
returns table (
  organization_id uuid,
  plano public.plano_b2b,
  limite integer,
  limite_padrao_do_plano integer,
  alunos_ativos bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select o.id,
         o.plano_b2b,
         o.limite_alunos,
         public.limite_padrao_plano(o.plano_b2b),
         (select count(*) from public.alunos a
           where a.organization_id = o.id and a.anonimizado_em is null)
    from public.organizations o
   where public.is_org_staff(auth.uid(), o.id)
      or public.has_role(auth.uid(), 'admin_arke')
      or public.has_role(auth.uid(), 'superadmin');
end;
$$;

revoke all on function public.obter_uso_limite_alunos() from public, anon;
grant execute on function public.obter_uso_limite_alunos() to authenticated;
