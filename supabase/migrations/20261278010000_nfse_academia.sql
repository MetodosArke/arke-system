-- Nota fiscal automática da academia (NFS-e), 24/09/2026.
--
-- Regra do responsável: a responsabilidade fiscal segue o split. O Asaas divide
-- cada cobrança no ato, e cada parte trata do fiscal só do que entra no próprio
-- caixa. Por isso a nota da academia é emitida:
--   * na conta Asaas DA ACADEMIA (com a chave dela, do cofre), e não na da
--     ArkeFit — o dinheiro chega a ela pelo split, não por cobrança na conta
--     dela, então a nota é avulsa, por cliente;
--   * pelo valor que entrou no caixa dela (`valor_liquido_academia`), não pelo
--     bruto cobrado do aluno.
-- A configuração fiscal (inscrição municipal, regime, certificado, serviço,
-- ISS) é preenchida pela própria academia: cada prefeitura exige uma coisa, e
-- o Asaas diz o que é (`/fiscalInfo/municipalOptions`). O ARKE não guarda
-- certificado, senha nem token da prefeitura — tudo vai direto ao Asaas.
--
-- O sandbox decidiu duas coisas: (1) sem autenticação na prefeitura o Asaas
-- recusa emitir ("informar ao menos um meio de autenticação"); (2) a prefeitura
-- exige o endereço do tomador — o aluno —, e o ARKE não guardava endereço.

-- ── Endereço do aluno ────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  add column if not exists logradouro text check (logradouro is null or char_length(logradouro) <= 150),
  add column if not exists endereco_numero text check (endereco_numero is null or char_length(endereco_numero) <= 20),
  add column if not exists complemento text check (complemento is null or char_length(complemento) <= 60),
  add column if not exists bairro text check (bairro is null or char_length(bairro) <= 80),
  add column if not exists cidade text check (cidade is null or char_length(cidade) <= 80),
  add column if not exists uf text check (uf is null or uf ~ '^[A-Z]{2}$');

-- Uma porta só para gravar o endereço: o próprio aluno, ou a gestão e a
-- recepção da academia dele. A política de UPDATE de `profiles` só deixa a
-- pessoa alterar o próprio cadastro, e a recepção precisa preencher o de quem
-- não usa o app. Gravar libera as notas que esperavam o endereço.
create or replace function public.atualizar_endereco_aluno(
  _aluno_id uuid, _cep text, _logradouro text, _numero text, _complemento text,
  _bairro text, _cidade text, _uf text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_org uuid;
  v_cep text := regexp_replace(coalesce(_cep, ''), '\D', '', 'g');
  v_uf text := upper(btrim(coalesce(_uf, '')));
begin
  select a.user_id, a.organization_id into v_user, v_org from public.alunos a where a.id = _aluno_id;
  if v_user is null then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;
  if not (v_user = auth.uid()
          or public.has_org_role(auth.uid(), v_org, 'gestor')
          or public.has_org_role(auth.uid(), v_org, 'recepcao')) then
    raise exception 'Só o próprio aluno, a gestão ou a recepção alteram o endereço.' using errcode = '42501';
  end if;
  if length(v_cep) <> 8 then raise exception 'CEP inválido — são 8 números.' using errcode = '22023'; end if;
  if btrim(coalesce(_logradouro, '')) = '' or btrim(coalesce(_numero, '')) = ''
     or btrim(coalesce(_bairro, '')) = '' or btrim(coalesce(_cidade, '')) = '' then
    raise exception 'Preencha rua, número, bairro e cidade.' using errcode = '22023';
  end if;
  if v_uf !~ '^[A-Z]{2}$' then raise exception 'UF inválida.' using errcode = '22023'; end if;

  update public.profiles
     set cep = v_cep,
         logradouro = left(btrim(_logradouro), 150),
         endereco_numero = left(btrim(_numero), 20),
         complemento = nullif(left(btrim(coalesce(_complemento, '')), 60), ''),
         bairro = left(btrim(_bairro), 80),
         cidade = left(btrim(_cidade), 80),
         uf = v_uf
   where user_id = v_user;

  update public.notas_fiscais
     set status = 'pendente', erro = null, proxima_tentativa_em = now()
   where status = 'sem_endereco'
     and aluno_id in (select a.id from public.alunos a where a.user_id = v_user);
end;
$$;

-- ── Configuração fiscal da academia ─────────────────────────────────────────
-- Só o que não é segredo. O que a prefeitura pede de sensível fica no Asaas.
create table public.organizacao_fiscal (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  emissao_ativa boolean not null default false,
  servico_municipal_id text,
  servico_municipal_codigo text,
  servico_municipal_nome text check (servico_municipal_nome is null or char_length(servico_municipal_nome) <= 300),
  aliquota_iss numeric(5, 2) check (aliquota_iss is null or (aliquota_iss >= 0 and aliquota_iss <= 10)),
  observacoes text check (observacoes is null or char_length(observacoes) <= 400),
  cidade text,
  uf text,
  -- O que a prefeitura exige (CERTIFICATE, TOKEN, USER_AND_PASSWORD) e se já
  -- foi enviado ao Asaas. Lido do Asaas a cada verificação, não digitado.
  autenticacao text,
  autenticacao_enviada boolean not null default false,
  cadastro_enviado boolean not null default false,
  verificado_em timestamptz,
  atualizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_organizacao_fiscal_atualizado_por on public.organizacao_fiscal (atualizado_por);
create trigger trg_organizacao_fiscal_updated_at before update on public.organizacao_fiscal
  for each row execute function public.set_updated_at();

alter table public.organizacao_fiscal enable row level security;
-- Leitura pela equipe e pela ArkeFit; escrita só pela edge function, que
-- confere o papel e fala com o Asaas antes de gravar.
create policy "leitura" on public.organizacao_fiscal for select to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id)
         or public.has_role((select auth.uid()), 'superadmin'));
grant select on public.organizacao_fiscal to authenticated;
grant all on public.organizacao_fiscal to service_role;

-- ── Notas fiscais: fila e registro ──────────────────────────────────────────
create table public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- A nota é documento fiscal: excluir o aluno não apaga o registro dela.
  aluno_id uuid references public.alunos(id) on delete set null,
  origem text not null check (origem in ('mensalidade', 'avulsa', 'metodo')),
  origem_id uuid not null,
  valor numeric(10, 2) not null check (valor > 0),
  descricao text not null check (char_length(descricao) <= 200),
  competencia date not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'sem_endereco', 'agendada', 'emitida', 'erro', 'cancelar', 'cancelando', 'cancelada')),
  asaas_invoice_id text unique,
  numero text,
  pdf_url text,
  xml_url text,
  erro text,
  tentativas int not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  emitida_em timestamptz,
  cancelada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (origem, origem_id)
);
create index idx_notas_fiscais_fila on public.notas_fiscais (status, proxima_tentativa_em);
create index idx_notas_fiscais_org on public.notas_fiscais (organization_id, created_at desc);
create index idx_notas_fiscais_aluno on public.notas_fiscais (aluno_id);
create trigger trg_notas_fiscais_updated_at before update on public.notas_fiscais
  for each row execute function public.set_updated_at();

alter table public.notas_fiscais enable row level security;
-- O aluno vê as próprias (para baixar a nota); a equipe vê as da academia.
create policy "leitura" on public.notas_fiscais for select to authenticated
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
    or public.has_role((select auth.uid()), 'superadmin')
  );
grant select on public.notas_fiscais to authenticated;
grant all on public.notas_fiscais to service_role;

-- ── Pagamento confirmado entra na fila; estorno pede o cancelamento ─────────
-- Um gatilho para as três origens: mensalidade do plano, cobrança avulsa e a
-- parte da academia na cobrança do Método. Base = o que entrou no caixa da
-- academia. Só enfileira com a emissão ligada: ligar depois não emite o
-- passado, de propósito — nota retroativa é decisão do contador da academia.
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
begin
  v_origem := case tg_table_name
    when 'mensalidades' then 'mensalidade'
    when 'cobrancas_avulsas' then 'avulsa'
    when 'pagamentos' then 'metodo'
  end;

  if new.status = 'confirmado' and old.status is distinct from 'confirmado' then
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

  elsif new.status = 'estornado' and old.status = 'confirmado' then
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

create trigger trg_enfileirar_nota_fiscal after update on public.mensalidades
  for each row execute function public.enfileirar_nota_fiscal();
create trigger trg_enfileirar_nota_fiscal after update on public.cobrancas_avulsas
  for each row execute function public.enfileirar_nota_fiscal();
create trigger trg_enfileirar_nota_fiscal after update on public.pagamentos
  for each row execute function public.enfileirar_nota_fiscal();

-- Tentar de novo: a nota volta para a fila e a próxima rodada (até 10 min) emite.
create or replace function public.reprocessar_nota_fiscal(_nota_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.notas_fiscais where id = _nota_id;
  if v_org is null then raise exception 'Nota não encontrada.' using errcode = 'P0002'; end if;
  if not (public.has_org_role(auth.uid(), v_org, 'gestor') or public.has_org_role(auth.uid(), v_org, 'recepcao')) then
    raise exception 'Só a gestão e a recepção reenviam notas.' using errcode = '42501';
  end if;
  update public.notas_fiscais
     set status = 'pendente', erro = null, tentativas = 0, proxima_tentativa_em = now()
   where id = _nota_id and status in ('erro', 'sem_endereco');
end;
$$;

revoke execute on function public.atualizar_endereco_aluno(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.atualizar_endereco_aluno(uuid, text, text, text, text, text, text, text) to authenticated, service_role;
revoke execute on function public.reprocessar_nota_fiscal(uuid) from public, anon;
grant execute on function public.reprocessar_nota_fiscal(uuid) to authenticated, service_role;
revoke execute on function public.enfileirar_nota_fiscal() from public, anon, authenticated;

-- ── A rotina: de 10 em 10 minutos, emite e acompanha ────────────────────────
-- Mesmo token do Vault que o alerta de rotinas usa; a função registra o
-- próprio desfecho em execucoes_agendadas, e o alerta de rotinas e o Vigia a
-- vigiam como as outras.
select cron.schedule(
  'arke-emitir-notas',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/nfse-emitir',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);
