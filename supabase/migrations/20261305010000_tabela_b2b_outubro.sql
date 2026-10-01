-- Tabela B2B de 01/10/2026 (decisão do responsável, depois da pesquisa de
-- preços dos concorrentes):
--
--   Growth      R$ 390   até 300 alunos ativos
--   Enterprise  R$ 790   a partir de 301 alunos, sem teto
--   Redes       R$ 1.290 academias com até 3 unidades, sem teto de alunos
--   Custom      sob consulta, redes com mais de 3 unidades
--   Implantação R$ 500 de referência
--
-- O Starter sai de venda. O valor do enum fica, porque o histórico pode
-- apontar para ele, mas a linha de preço sai da tabela.
--
-- Defeito antigo corrigido junto: o limite de alunos não acompanhava o plano.
-- Toda organização nascia com 150 (o default da coluna) e trocar de plano não
-- mudava o limite; as três organizações de teste estavam com 150, inclusive a
-- do Enterprise. Com planos sem teto, isso barraria a academia aos 150 alunos.
-- Agora o limite segue o plano, e a fonte é uma só: planos_b2b_precos.

-- ── Tabela de preços ─────────────────────────────────────────────────────────

update public.planos_b2b_precos set valor_mensal = 390, limite_alunos = 300, updated_at = now() where plano = 'growth';
update public.planos_b2b_precos set valor_mensal = 790, limite_alunos = null, updated_at = now() where plano = 'enterprise';
insert into public.planos_b2b_precos (plano, valor_mensal, limite_alunos, updated_at)
values ('redes', 1290, null, now())
on conflict (plano) do update set valor_mensal = excluded.valor_mensal, limite_alunos = excluded.limite_alunos, updated_at = now();
delete from public.planos_b2b_precos where plano = 'starter';

update public.plataforma_config set valor = 500, updated_at = now() where chave = 'taxa_implantacao_referencia';

-- ── O limite segue o plano ──────────────────────────────────────────────────

-- Uma fonte só: a tabela de preços. Antes, os números estavam escritos aqui
-- à mão e de novo na tabela, e os dois podiam divergir.
create or replace function public.limite_padrao_plano(_plano public.plano_b2b)
returns integer
language sql
stable
set search_path = public
as $$
  select p.limite_alunos from public.planos_b2b_precos p where p.plano = _plano;
$$;

comment on function public.limite_padrao_plano(public.plano_b2b) is
  'Teto de alunos do plano B2B, lido de planos_b2b_precos. NULL = sem teto (Enterprise, Redes) ou negociado (Custom, autônomo).';

-- Plano de tabela é o que tem preço em planos_b2b_precos. Nele, o limite
-- segue a tabela (NULL = sem teto). Custom e autônomo não têm preço de
-- tabela: o limite deles é negociado e não é tocado aqui.
create or replace function public.limite_segue_plano()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_de_tabela boolean;
begin
  select p.valor_mensal is not null into v_de_tabela
    from public.planos_b2b_precos p
   where p.plano = new.plano_b2b;

  if not coalesce(v_de_tabela, false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.limite_alunos := public.limite_padrao_plano(new.plano_b2b);
  elsif new.plano_b2b is distinct from old.plano_b2b
        and new.limite_alunos is not distinct from old.limite_alunos then
    -- Trocou de plano sem mexer no limite: o limite vai junto. Quem quiser
    -- um limite negociado o informa na mesma alteração.
    new.limite_alunos := public.limite_padrao_plano(new.plano_b2b);
  end if;
  return new;
end;
$$;

-- O nome ordena antes de trg_proteger_colunas_organizacao: os gatilhos rodam
-- em ordem alfabética, e a proteção precisa ver o limite já ajustado.
drop trigger if exists trg_limite_segue_plano on public.organizations;
create trigger trg_limite_segue_plano
  before insert or update of plano_b2b on public.organizations
  for each row execute function public.limite_segue_plano();

revoke execute on function public.limite_segue_plano() from public, anon, authenticated;

-- Sem teto é limite vazio. exigir_limite_alunos() e as telas já tratam
-- vazio como sem limite; só a coluna recusava.
alter table public.organizations alter column limite_alunos drop not null;

alter table public.organizations alter column plano_b2b set default 'growth';

-- As organizações que existem passam a ter o limite do plano delas.
update public.organizations o
   set limite_alunos = public.limite_padrao_plano(o.plano_b2b)
 where exists (select 1 from public.planos_b2b_precos p where p.plano = o.plano_b2b and p.valor_mensal is not null);

-- ── Redes: as outras unidades não pagam à parte ─────────────────────────────

-- A rede paga R$ 1.290 numa unidade, a principal. As outras unidades da rede
-- (até 3 no total) ficam no plano Redes com mensalidade negociada zero, que
-- não gera cobrança B2B (asaas-assinatura-b2b pula). Antes, zero era recusado.
alter table public.organizations drop constraint if exists organizations_valor_mensal_b2b_check;
alter table public.organizations
  add constraint organizations_valor_mensal_b2b_check check (valor_mensal_b2b is null or valor_mensal_b2b >= 0);

comment on column public.organizations.valor_mensal_b2b is
  'Mensalidade B2B negociada; NULL usa o preço de tabela do plano. Zero = unidade de rede cobrada na unidade principal, sem assinatura própria.';
