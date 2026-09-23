-- `ON CONFLICT` que não casa com o índice parcial (23/09/2026).
--
-- Encontrado ao rodar pela primeira vez a mensalidade de plano próprio de
-- ponta a ponta: confirmar o pagamento levantava `42P10 — there is no unique
-- or exclusion constraint matching the ON CONFLICT specification`.
--
-- O índice existe, e é **parcial**:
--
--   create unique index idx_lancamentos_financeiros_origem_automatica
--     on public.lancamentos_financeiros (organization_id, origem_automatica)
--     where origem_automatica is not null;
--
-- O PostgreSQL só infere um índice parcial quando o `ON CONFLICT` repete o
-- predicado dele. Sem o `where`, a inferência não encontra índice nenhum e a
-- instrução falha — em tempo de execução, nunca na criação da função. Por
-- isso as duas passaram despercebidas: o código está correto à leitura.
--
-- Duas funções tinham o defeito, e as duas quebrariam no primeiro uso real:
--
--   * `lancar_receita_mensalidade` — dispara ao confirmar a mensalidade paga
--     pelo aluno. Como é gatilho `after update` na própria `mensalidades`, a
--     exceção derrubaria a transação inteira: o webhook do Asaas não
--     conseguiria marcar a cobrança como confirmada, e o aluno ficaria
--     "devendo" uma mensalidade que pagou;
--   * `lancar_despesa_folha` — dispara ao fechar a folha do mês.
--
-- A correção é só repetir o predicado. O efeito pretendido (não duplicar o
-- lançamento automático) passa a de fato acontecer.

create or replace function public.lancar_receita_mensalidade()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_categoria_id uuid;
begin
  if new.status = 'confirmado' and old.status is distinct from 'confirmado' then
    select id into v_categoria_id from public.plano_contas
      where organization_id = new.organization_id and tipo = 'receita' and nome = 'Mensalidades (automático)';
    if v_categoria_id is null then
      insert into public.plano_contas (organization_id, tipo, nome)
        values (new.organization_id, 'receita', 'Mensalidades (automático)')
        returning id into v_categoria_id;
    end if;

    insert into public.lancamentos_financeiros
      (organization_id, tipo, categoria_id, categoria, descricao, valor, data, status, data_pagamento, origem_automatica)
    values
      (new.organization_id, 'receita', v_categoria_id, 'Mensalidades (automático)', 'Mensalidade da academia paga via Asaas',
       new.valor_liquido_academia, coalesce(new.data_pagamento, current_date), 'pago', coalesce(new.data_pagamento, current_date),
       'mensalidade:' || new.id::text)
    -- O `where` repete o predicado do índice parcial; sem ele o Postgres não
    -- o infere e a instrução falha em tempo de execução.
    on conflict (organization_id, origem_automatica) where origem_automatica is not null do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.lancar_despesa_folha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_categoria_id uuid;
begin
  if new.status = 'pago' and old.status is distinct from 'pago' then
    select id into v_categoria_id from public.plano_contas
      where organization_id = new.organization_id and tipo = 'despesa' and nome = 'Folha de pagamento (automático)';
    if v_categoria_id is null then
      insert into public.plano_contas (organization_id, tipo, nome)
        values (new.organization_id, 'despesa', 'Folha de pagamento (automático)')
        returning id into v_categoria_id;
    end if;

    insert into public.lancamentos_financeiros
      (organization_id, tipo, categoria_id, categoria, descricao, valor, data, status, data_pagamento, origem_automatica)
    values
      (new.organization_id, 'despesa', v_categoria_id, 'Folha de pagamento (automático)', 'Fechamento de folha do mês',
       new.valor_total, coalesce(new.data_pagamento, current_date), 'pago', coalesce(new.data_pagamento, current_date),
       'folha_pagamento:' || new.id::text)
    on conflict (organization_id, origem_automatica) where origem_automatica is not null do nothing;
  end if;
  return new;
end;
$$;

-- Funções de gatilho herdam EXECUTE do PUBLIC e reaparecem em /rest/v1/rpc a
-- cada `create or replace`. Regra do projeto: revogar de novo.
revoke execute on function public.lancar_receita_mensalidade() from public;
revoke execute on function public.lancar_despesa_folha() from public;
