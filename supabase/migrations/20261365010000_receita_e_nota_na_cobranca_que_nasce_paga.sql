-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A cobrança que já nasce paga também vira receita e nota fiscal (06/10/2026).
--
-- Os três gatilhos do dinheiro que entrou (o lançamento de receita da
-- mensalidade, o da cobrança avulsa e a fila da nota fiscal) eram só
-- `after update`: olhavam a troca de status para `confirmado`. Só que a linha
-- pode nascer confirmada. É o caso do aviso de emissão (`PAYMENT_CREATED`)
-- que se perde: a primeira notícia da cobrança é a confirmação, que a
-- conferência diária reenvia, e o webhook cria a linha já paga. Ninguém faz
-- `update`, e o pagamento ficava sem lançamento e sem nota.
--
-- Agora os três valem também na inclusão. No fluxo normal (a linha nasce
-- pendente e depois confirma) nada muda: a inclusão pendente não lança nada,
-- e a confirmação continua pelo `update`. E nada duplica: o lançamento é
-- único por `origem_automatica` e a nota por `(origem, origem_id)`, com
-- `on conflict do nothing` nos dois.
--
-- O upsert do webhook (`insert ... on conflict do update`) dispara o gatilho
-- de inclusão só quando a linha é nova; quando ela já existe, dispara o de
-- alteração. Os dois caminhos ficam cobertos sem conta dupla.

-- ── Receita da mensalidade ───────────────────────────────────────────────────
create or replace function public.lancar_receita_mensalidade()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_categoria_id uuid;
begin
  if new.status is distinct from 'confirmado' then
    return new;
  end if;
  -- Na alteração, só a troca para confirmado lança; na inclusão, a linha que
  -- já nasce confirmada.
  if tg_op = 'UPDATE' then
    if old.status is not distinct from 'confirmado' then
      return new;
    end if;
  end if;

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
  return new;
end;
$$;

drop trigger if exists trg_lancar_receita_mensalidade on public.mensalidades;
create trigger trg_lancar_receita_mensalidade
  after insert or update on public.mensalidades
  for each row execute function public.lancar_receita_mensalidade();

-- ── Receita da cobrança avulsa ───────────────────────────────────────────────
create or replace function public.lancar_receita_cobranca_avulsa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categoria_id uuid;
begin
  if new.status is distinct from 'confirmado' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status is not distinct from 'confirmado' then
      return new;
    end if;
  end if;

  select id into v_categoria_id from public.plano_contas
    where organization_id = new.organization_id and tipo = 'receita' and nome = 'Cobranças avulsas (automático)';
  if v_categoria_id is null then
    insert into public.plano_contas (organization_id, tipo, nome)
      values (new.organization_id, 'receita', 'Cobranças avulsas (automático)')
      returning id into v_categoria_id;
  end if;

  insert into public.lancamentos_financeiros
    (organization_id, tipo, categoria_id, categoria, descricao, valor, data, status, data_pagamento, origem_automatica)
  values
    (new.organization_id, 'receita', v_categoria_id, 'Cobranças avulsas (automático)',
     new.descricao || ' — paga via Asaas',
     new.valor_liquido_academia, coalesce(new.data_pagamento, current_date), 'pago',
     coalesce(new.data_pagamento, current_date), 'avulsa:' || new.id::text)
  on conflict (organization_id, origem_automatica) where origem_automatica is not null do nothing;
  return new;
end;
$$;

drop trigger if exists trg_lancar_receita_cobranca_avulsa on public.cobrancas_avulsas;
create trigger trg_lancar_receita_cobranca_avulsa
  after insert or update on public.cobrancas_avulsas
  for each row execute function public.lancar_receita_cobranca_avulsa();

-- ── Fila da nota fiscal ──────────────────────────────────────────────────────
-- O mesmo corpo de 20261278010000, com a inclusão confirmada entrando na fila.
-- O estorno continua só na alteração: uma linha não nasce estornada de uma
-- cobrança paga que ela mesma registrou.
create or replace function public.enfileirar_nota_fiscal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origem text;
  v_aluno uuid;
  v_descricao text;
  v_valor numeric;
  v_confirmou boolean;
begin
  v_origem := case tg_table_name
    when 'mensalidades' then 'mensalidade'
    when 'cobrancas_avulsas' then 'avulsa'
    when 'pagamentos' then 'metodo'
  end;

  v_confirmou := new.status = 'confirmado';
  if v_confirmou and tg_op = 'UPDATE' then
    v_confirmou := old.status is distinct from 'confirmado';
  end if;

  if v_confirmou then
    if not exists (select 1 from public.organizacao_fiscal f
                    where f.organization_id = new.organization_id and f.emissao_ativa) then
      return new;
    end if;

    if tg_table_name = 'mensalidades' then
      v_aluno := new.aluno_id;
      select 'Mensalidade — ' || coalesce(p.nome, 'plano da academia') into v_descricao
        from public.aluno_matriculas_academia m
        left join public.planos_academia p on p.id = m.plano_id
       where m.id = new.matricula_id;
      v_descricao := coalesce(v_descricao, 'Mensalidade');
    elsif tg_table_name = 'cobrancas_avulsas' then
      v_aluno := new.aluno_id;
      v_descricao := new.descricao;
    else
      select s.aluno_id into v_aluno from public.aluno_assinaturas s where s.id = new.aluno_assinatura_id;
      v_descricao := 'Método ARKE';
    end if;

    v_valor := coalesce(new.valor_liquido_academia, new.valor);
    if v_valor is null or v_valor <= 0 then
      return new;
    end if;

    insert into public.notas_fiscais (organization_id, aluno_id, origem, origem_id, valor, descricao, competencia)
    values (new.organization_id, v_aluno, v_origem, new.id, round(v_valor, 2), left(v_descricao, 200),
            coalesce(new.data_pagamento, current_date))
    on conflict (origem, origem_id) do nothing;

  elsif tg_op = 'UPDATE' and new.status = 'estornado' and old.status = 'confirmado' then
    -- Emitida (ou a caminho) é cancelada na prefeitura; a que nunca saiu só sai da fila.
    update public.notas_fiscais
       set status = 'cancelar', proxima_tentativa_em = now()
     where origem = v_origem and origem_id = new.id and status in ('emitida', 'agendada');
    update public.notas_fiscais
       set status = 'cancelada', cancelada_em = now()
     where origem = v_origem and origem_id = new.id and status in ('pendente', 'sem_endereco', 'erro');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enfileirar_nota_fiscal on public.mensalidades;
create trigger trg_enfileirar_nota_fiscal after insert or update on public.mensalidades
  for each row execute function public.enfileirar_nota_fiscal();
drop trigger if exists trg_enfileirar_nota_fiscal on public.cobrancas_avulsas;
create trigger trg_enfileirar_nota_fiscal after insert or update on public.cobrancas_avulsas
  for each row execute function public.enfileirar_nota_fiscal();
drop trigger if exists trg_enfileirar_nota_fiscal on public.pagamentos;
create trigger trg_enfileirar_nota_fiscal after insert or update on public.pagamentos
  for each row execute function public.enfileirar_nota_fiscal();

-- Funções de gatilho herdam EXECUTE do PUBLIC a cada `create or replace`.
revoke execute on function public.lancar_receita_mensalidade() from public, anon, authenticated;
revoke execute on function public.lancar_receita_cobranca_avulsa() from public, anon, authenticated;
revoke execute on function public.enfileirar_nota_fiscal() from public, anon, authenticated;
