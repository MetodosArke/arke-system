-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A loja da academia (reunião de 10/11/2026): cadastrar e vender produtos, sem nota
-- fiscal por enquanto. A venda é feita pela equipe que cuida do dinheiro (gestão e
-- recepção), no balcão (dinheiro, PIX ou cartão na maquininha, já pagos) ou por
-- cobrança ao aluno no Asaas (a cobrança avulsa de tipo "produto", que já existe).
-- O estoque baixa na venda e volta no cancelamento.

-- ── 1. Produtos ────────────────────────────────────────────────────────────
create table if not exists public.produtos_loja (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 120),
  descricao text check (descricao is null or length(descricao) <= 1000),
  preco numeric(10, 2) not null check (preco > 0 and preco <= 100000),
  -- Sem controle de estoque: nulo.
  estoque integer check (estoque is null or estoque >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.produtos_loja is
  'Os produtos da loja da academia. Some da venda pelo ativo = false, sem apagar: as vendas apontam para ele.';
create index if not exists idx_produtos_loja_org on public.produtos_loja (organization_id, ativo);
create trigger trg_produtos_loja_updated_at before update on public.produtos_loja
  for each row execute function public.set_updated_at();

alter table public.produtos_loja enable row level security;
-- A equipe vê o catálogo; quem cuida do dinheiro cadastra e altera. Sem exclusão.
create policy "leitura" on public.produtos_loja for select to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id));
create policy "inclusão" on public.produtos_loja for insert to authenticated
  with check (public.cuida_do_dinheiro(organization_id));
create policy "alteração" on public.produtos_loja for update to authenticated
  using (public.cuida_do_dinheiro(organization_id))
  with check (public.cuida_do_dinheiro(organization_id));
revoke delete, truncate on public.produtos_loja from anon, authenticated;
revoke select, insert, update on public.produtos_loja from anon;
drop policy if exists "duas etapas" on public.produtos_loja;
create policy "duas etapas" on public.produtos_loja as restrictive for all to authenticated
  using ((select public.sessao_cumpre_duas_etapas()))
  with check ((select public.sessao_cumpre_duas_etapas()));

-- ── 2. Vendas ──────────────────────────────────────────────────────────────
create table if not exists public.vendas_loja (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  produto_id uuid not null references public.produtos_loja(id),
  -- Venda de balcão pode ser sem aluno; a cobrança no Asaas é sempre a um aluno.
  aluno_id uuid references public.alunos(id) on delete set null,
  quantidade integer not null check (quantidade between 1 and 100),
  valor_unitario numeric(10, 2) not null check (valor_unitario > 0),
  valor_total numeric(10, 2) not null check (valor_total > 0),
  forma_pagamento text not null check (forma_pagamento in ('dinheiro', 'pix', 'cartao', 'cobranca')),
  cobranca_avulsa_id uuid references public.cobrancas_avulsas(id) on delete set null,
  status text not null check (status in ('paga', 'pendente', 'cancelada')),
  vendido_por uuid,
  cancelada_em timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.vendas_loja is
  'As vendas da loja. Grava só pelas funções (registrar, vincular, cancelar); a cobrança paga ou cancelada no Asaas muda a venda pelo gatilho.';
create index if not exists idx_vendas_loja_org on public.vendas_loja (organization_id, created_at desc);
create index if not exists idx_vendas_loja_cobranca on public.vendas_loja (cobranca_avulsa_id) where cobranca_avulsa_id is not null;

alter table public.vendas_loja enable row level security;
create policy "leitura" on public.vendas_loja for select to authenticated
  using (public.cuida_do_dinheiro(organization_id));
revoke insert, update, delete, truncate on public.vendas_loja from anon, authenticated;
revoke select on public.vendas_loja from anon;
drop policy if exists "duas etapas" on public.vendas_loja;
create policy "duas etapas" on public.vendas_loja as restrictive for all to authenticated
  using ((select public.sessao_cumpre_duas_etapas()))
  with check ((select public.sessao_cumpre_duas_etapas()));

-- ── 3. Vender ──────────────────────────────────────────────────────────────
-- Confere quem chama (quem cuida do dinheiro da academia do produto, com as duas
-- etapas), trava a linha do produto para o estoque não vender o que não tem, e
-- grava a venda. A de balcão nasce paga e lança a receita no financeiro; a de
-- cobrança nasce pendente e espera a cobrança do Asaas.
create or replace function public.registrar_venda_loja(
  _produto_id uuid,
  _quantidade integer,
  _forma text,
  _aluno_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_produto public.produtos_loja%rowtype;
  v_venda uuid;
  v_total numeric(10, 2);
  v_categoria uuid;
begin
  select * into v_produto from public.produtos_loja where id = _produto_id for update;
  if v_produto.id is null then
    raise exception 'Produto não encontrado.' using errcode = 'no_data_found';
  end if;
  if not public.cuida_do_dinheiro(v_produto.organization_id) or not public.sessao_cumpre_duas_etapas() then
    raise exception 'Só a gestão e a recepção da academia vendem na loja.' using errcode = '42501';
  end if;
  if not v_produto.ativo then
    raise exception 'Este produto está inativo.' using errcode = '22023';
  end if;
  if _quantidade is null or _quantidade not between 1 and 100 then
    raise exception 'A quantidade vai de 1 a 100.' using errcode = '22023';
  end if;
  if _forma not in ('dinheiro', 'pix', 'cartao', 'cobranca') then
    raise exception 'Forma de pagamento inválida.' using errcode = '22023';
  end if;
  if _forma = 'cobranca' and _aluno_id is null then
    raise exception 'A cobrança no Asaas vai para um aluno: escolha o aluno.' using errcode = '22023';
  end if;
  if _aluno_id is not null and not exists (
    select 1 from public.alunos a where a.id = _aluno_id and a.organization_id = v_produto.organization_id
  ) then
    raise exception 'Aluno não encontrado nesta academia.' using errcode = 'no_data_found';
  end if;
  if v_produto.estoque is not null and v_produto.estoque < _quantidade then
    raise exception 'Estoque insuficiente: há % unidade(s).', v_produto.estoque using errcode = '22023';
  end if;

  v_total := round(v_produto.preco * _quantidade, 2);
  insert into public.vendas_loja (organization_id, produto_id, aluno_id, quantidade, valor_unitario, valor_total,
                                  forma_pagamento, status, vendido_por)
  values (v_produto.organization_id, v_produto.id, _aluno_id, _quantidade, v_produto.preco, v_total,
          _forma, case when _forma = 'cobranca' then 'pendente' else 'paga' end, auth.uid())
  returning id into v_venda;

  if v_produto.estoque is not null then
    update public.produtos_loja set estoque = estoque - _quantidade where id = v_produto.id;
  end if;

  -- O dinheiro do balcão já entrou: vai ao financeiro, como a cobrança avulsa paga.
  if _forma <> 'cobranca' then
    select id into v_categoria from public.plano_contas
     where organization_id = v_produto.organization_id and tipo = 'receita' and nome = 'Loja (automático)';
    if v_categoria is null then
      insert into public.plano_contas (organization_id, tipo, nome)
        values (v_produto.organization_id, 'receita', 'Loja (automático)')
        returning id into v_categoria;
    end if;
    insert into public.lancamentos_financeiros
      (organization_id, tipo, categoria_id, categoria, descricao, valor, data, status, data_pagamento,
       forma_pagamento, registrado_por, origem_automatica)
    values
      (v_produto.organization_id, 'receita', v_categoria, 'Loja (automático)',
       _quantidade || ' × ' || v_produto.nome, v_total, current_date, 'pago', current_date,
       case _forma when 'dinheiro' then 'Dinheiro' when 'pix' then 'PIX' else 'Cartão' end,
       auth.uid(), 'loja:' || v_venda::text)
    on conflict (organization_id, origem_automatica) where origem_automatica is not null do nothing;
  end if;
  return v_venda;
end;
$function$;

-- A cobrança emitida no Asaas (pela edge function da cobrança avulsa) fica ligada à
-- venda pendente. Confere a academia, o aluno e o tipo.
create or replace function public.vincular_cobranca_venda_loja(_venda_id uuid, _cobranca_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_venda public.vendas_loja%rowtype;
begin
  select * into v_venda from public.vendas_loja where id = _venda_id for update;
  if v_venda.id is null then
    raise exception 'Venda não encontrada.' using errcode = 'no_data_found';
  end if;
  if not public.cuida_do_dinheiro(v_venda.organization_id) or not public.sessao_cumpre_duas_etapas() then
    raise exception 'Só a gestão e a recepção da academia mexem nas vendas.' using errcode = '42501';
  end if;
  if v_venda.forma_pagamento <> 'cobranca' or v_venda.status <> 'pendente' or v_venda.cobranca_avulsa_id is not null then
    raise exception 'Esta venda não espera cobrança.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cobrancas_avulsas c
     where c.id = _cobranca_id and c.organization_id = v_venda.organization_id
       and c.aluno_id = v_venda.aluno_id and c.tipo = 'produto'
  ) then
    raise exception 'A cobrança não confere com a venda.' using errcode = '22023';
  end if;
  update public.vendas_loja set cobranca_avulsa_id = _cobranca_id where id = _venda_id;
end;
$function$;

-- Cancelar devolve o estoque. A venda de balcão cancela também a receita lançada; a de
-- cobrança só cancela sem cobrança em aberto (a tela cancela a cobrança antes).
create or replace function public.cancelar_venda_loja(_venda_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_venda public.vendas_loja%rowtype;
begin
  select * into v_venda from public.vendas_loja where id = _venda_id for update;
  if v_venda.id is null then
    raise exception 'Venda não encontrada.' using errcode = 'no_data_found';
  end if;
  if not public.cuida_do_dinheiro(v_venda.organization_id) or not public.sessao_cumpre_duas_etapas() then
    raise exception 'Só a gestão e a recepção da academia mexem nas vendas.' using errcode = '42501';
  end if;
  if v_venda.status = 'cancelada' then
    return;
  end if;
  if v_venda.forma_pagamento = 'cobranca' then
    if v_venda.status = 'paga' then
      raise exception 'A cobrança desta venda já foi paga: o estorno é pelo Asaas.' using errcode = '22023';
    end if;
    if exists (select 1 from public.cobrancas_avulsas c
                where c.id = v_venda.cobranca_avulsa_id and c.status in ('pendente', 'atrasado')) then
      raise exception 'Cancele antes a cobrança em aberto desta venda.' using errcode = '22023';
    end if;
  else
    update public.lancamentos_financeiros set status = 'cancelado'
     where organization_id = v_venda.organization_id and origem_automatica = 'loja:' || v_venda.id::text;
  end if;
  update public.vendas_loja set status = 'cancelada', cancelada_em = now() where id = _venda_id;
  update public.produtos_loja set estoque = estoque + v_venda.quantidade
   where id = v_venda.produto_id and estoque is not null;
end;
$function$;

revoke execute on function public.registrar_venda_loja(uuid, integer, text, uuid) from public, anon;
revoke execute on function public.vincular_cobranca_venda_loja(uuid, uuid) from public, anon;
revoke execute on function public.cancelar_venda_loja(uuid) from public, anon;
grant execute on function public.registrar_venda_loja(uuid, integer, text, uuid) to authenticated;
grant execute on function public.vincular_cobranca_venda_loja(uuid, uuid) to authenticated;
grant execute on function public.cancelar_venda_loja(uuid) to authenticated;

-- ── 4. A cobrança muda a venda ─────────────────────────────────────────────
-- Paga no Asaas, a venda fica paga (a receita já entra pelo gatilho da cobrança
-- avulsa). Cancelada, a venda pendente cancela e o estoque volta. After insert or
-- update: a cobrança pode nascer confirmada.
create or replace function public.venda_loja_segue_cobranca()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_venda public.vendas_loja%rowtype;
begin
  if new.tipo <> 'produto' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  select * into v_venda from public.vendas_loja
   where cobranca_avulsa_id = new.id and status = 'pendente' for update;
  if v_venda.id is null then
    return new;
  end if;
  if new.status = 'confirmado' then
    update public.vendas_loja set status = 'paga' where id = v_venda.id;
  elsif new.status = 'cancelado' then
    update public.vendas_loja set status = 'cancelada', cancelada_em = now() where id = v_venda.id;
    update public.produtos_loja set estoque = estoque + v_venda.quantidade
     where id = v_venda.produto_id and estoque is not null;
  end if;
  return new;
end;
$function$;
create trigger trg_venda_loja_segue_cobranca after insert or update on public.cobrancas_avulsas
  for each row execute function public.venda_loja_segue_cobranca();
revoke execute on function public.venda_loja_segue_cobranca() from public, anon, authenticated;

-- ── 5. Produto fora da fila da nota de serviço ─────────────────────────────
-- Mercadoria pede NF-e, que o sistema não emite; a NFS-e de um produto sairia
-- errada. A cobrança avulsa de tipo "produto" (da loja ou lançada à mão) não entra
-- na fila da nota. O resto da função é o mesmo.
create or replace function public.enfileirar_nota_fiscal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Aninhado de propósito: mensalidades e pagamentos não têm `tipo`, e o plpgsql
  -- não garante parar no primeiro lado de um `and`.
  if tg_table_name = 'cobrancas_avulsas' then
    if new.tipo = 'produto' then
      return new;
    end if;
  end if;

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
$function$;
revoke execute on function public.enfileirar_nota_fiscal() from public, anon, authenticated;
