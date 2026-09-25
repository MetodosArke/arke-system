-- Encerramento de academia (24/09/2026).
--
-- Até aqui "excluir organização" na Visão Master era um DELETE direto: não
-- cancelava a mensalidade B2B no Asaas (a ex-cliente seguiria cobrada), era
-- barrado por qualquer aluno com assinatura viva, deixava atestados, vídeos e
-- termos no storage e a chave da conta no cofre, não mandava apagar as
-- digitais das catracas e não entregava a exportação que o contrato promete.
-- E apagava junto os registros de receita da própria ArkeFit, que a lei manda
-- guardar.
--
-- O ciclo segue o Contrato da Academia (cláusulas 7 e 6, item 7):
--   aviso    → qualquer parte avisa com 30 dias (a academia pelo painel);
--   término  → as cobranças param, as digitais saem das catracas, a
--              organização vira `cancelado` e a academia tem mais 30 dias
--              para exportar os dados;
--   eliminação → o que é da ArkeFit por obrigação fiscal vai para o arquivo
--              fiscal (sem dado de aluno), e o resto é apagado: arquivos,
--              segredos, contas que só existiam ali e a organização.
-- Quem executa término e eliminação é a edge function `encerramento-organizacao`
-- (Asaas, storage e contas do Auth ficam fora do banco); o banco decide o que
-- está vencido e guarda cada passo.

create table public.organizacao_encerramentos (
  id uuid primary key default gen_random_uuid(),
  -- Sem cascade: o registro do encerramento sobrevive à organização, é a prova de que ela saiu direito.
  organization_id uuid references public.organizations(id) on delete set null,
  organizacao_nome text not null,
  organizacao_documento text,
  iniciativa text not null check (iniciativa in ('academia', 'arkefit')),
  motivo text not null check (char_length(btrim(motivo)) between 3 and 500),
  solicitado_em timestamptz not null default now(),
  solicitado_por uuid,
  termino_em date not null,
  eliminacao_em date not null,
  etapa text not null default 'aviso' check (etapa in ('aviso', 'encerrada', 'eliminada', 'retirado')),
  retirado_em timestamptz,
  retirado_por uuid,
  encerrada_em timestamptz,
  eliminada_em timestamptz,
  cobrancas_canceladas integer,
  remocoes_agendadas integer,
  arquivos_apagados integer,
  contas_apagadas integer,
  registros_fiscais integer,
  -- O aviso vai por e-mail à gestão da academia e à ArkeFit; nulo = ainda não foi.
  email_enviado_em timestamptz,
  erro text,
  tentativas integer not null default 0,
  updated_at timestamptz not null default now(),
  check (eliminacao_em >= termino_em)
);

-- Um encerramento em curso por organização.
create unique index organizacao_encerramentos_em_curso
  on public.organizacao_encerramentos (organization_id)
  where etapa in ('aviso', 'encerrada');

alter table public.organizacao_encerramentos enable row level security;

create policy "organizacao_encerramentos leitura" on public.organizacao_encerramentos
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin')
    or public.has_role(auth.uid(), 'admin_arke')
    or (organization_id is not null and public.has_org_role(auth.uid(), organization_id, 'gestor'))
  );

create trigger trg_organizacao_encerramentos_updated_at
  before update on public.organizacao_encerramentos
  for each row execute function public.set_updated_at();

-- ── Arquivo fiscal da ArkeFit ───────────────────────────────────────────────
-- O que entrou no caixa da ArkeFit por esta academia: a mensalidade B2B e o
-- repasse retido em cada cobrança a aluno. É registro da própria ArkeFit, que
-- a lei manda guardar; por isso fica, e por isso não leva dado de aluno —
-- nem nome, nem CPF, nem id.
create table public.arquivo_fiscal_arkefit (
  id uuid primary key default gen_random_uuid(),
  -- Sem FK: a organização deixa de existir; o id fica só para agrupar.
  organization_id uuid not null,
  organizacao_nome text not null,
  organizacao_documento text,
  origem text not null check (origem in ('b2b', 'metodo', 'plano', 'avulsa')),
  asaas_payment_id text,
  data_pagamento date,
  valor_cobrado numeric(12, 2) not null,
  valor_arkefit numeric(12, 2) not null,
  taxa_gateway numeric(12, 2),
  arquivado_em timestamptz not null default now()
);

create index arquivo_fiscal_arkefit_org on public.arquivo_fiscal_arkefit (organization_id);

alter table public.arquivo_fiscal_arkefit enable row level security;

create policy "arquivo_fiscal_arkefit leitura" on public.arquivo_fiscal_arkefit
  for select to authenticated
  using (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke'));

-- ── Aviso ───────────────────────────────────────────────────────────────────
-- A academia avisa pelo painel (só a gestão, só por iniciativa dela); a
-- ArkeFit avisa pela Visão Master. `_imediato` é o encerramento sem aviso por
-- violação grave dos Termos, que o contrato permite só à ArkeFit.
create or replace function public.avisar_encerramento_organizacao(
  _organization_id uuid, _motivo text, _iniciativa text, _imediato boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_arke boolean := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  v_org record;
  v_termino date;
  v_id uuid;
begin
  if _iniciativa not in ('academia', 'arkefit') then
    raise exception 'Iniciativa inválida.' using errcode = '22023';
  end if;
  if not v_arke then
    if not public.has_org_role(v_uid, _organization_id, 'gestor') then
      raise exception 'Só a gestão da academia ou a ArkeFit avisam o encerramento.' using errcode = '42501';
    end if;
    if _iniciativa <> 'academia' or _imediato then
      raise exception 'A academia só avisa o encerramento por iniciativa própria, com 30 dias.' using errcode = '42501';
    end if;
  end if;
  if _imediato and _iniciativa <> 'arkefit' then
    raise exception 'Encerramento imediato é só da ArkeFit, por violação grave dos Termos.' using errcode = '22023';
  end if;

  select id, nome, cnpj_cpf, status into v_org from public.organizations where id = _organization_id;
  if v_org.id is null then
    raise exception 'Academia não encontrada.' using errcode = 'P0002';
  end if;
  if v_org.status = 'trial' then
    -- Homologação não tem contrato nem cobrança: sai pela exclusão simples.
    raise exception 'Academia em homologação sai pela exclusão, não pelo encerramento.' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizacao_encerramentos
              where organization_id = _organization_id and etapa in ('aviso', 'encerrada')) then
    raise exception 'Esta academia já tem um encerramento em curso.' using errcode = '23505';
  end if;

  v_termino := case when _imediato then current_date else current_date + 30 end;
  insert into public.organizacao_encerramentos (
    organization_id, organizacao_nome, organizacao_documento, iniciativa, motivo, solicitado_por, termino_em, eliminacao_em)
  values (_organization_id, v_org.nome, v_org.cnpj_cpf, _iniciativa, btrim(_motivo), v_uid, v_termino, v_termino + 30)
  returning id into v_id;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select v_uid, u.email, 'organizacao.encerramento_avisado', 'organizacao_encerramentos', v_id, v_org.nome,
         jsonb_build_object('iniciativa', _iniciativa, 'motivo', btrim(_motivo), 'termino_em', v_termino, 'imediato', _imediato)
    from (select 1) um left join auth.users u on u.id = v_uid;
  return v_id;
end;
$$;
revoke execute on function public.avisar_encerramento_organizacao(uuid, text, text, boolean) from public, anon;
grant execute on function public.avisar_encerramento_organizacao(uuid, text, text, boolean) to authenticated;

-- Retirar o aviso antes do término: a ArkeFit sempre; a academia, se foi ela que avisou.
create or replace function public.retirar_encerramento_organizacao(_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_enc record;
begin
  select * into v_enc from public.organizacao_encerramentos
   where organization_id = _organization_id and etapa = 'aviso';
  if v_enc.id is null then
    raise exception 'Não há aviso de encerramento em curso para retirar.' using errcode = 'P0002';
  end if;
  if not (public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke')
          or (v_enc.iniciativa = 'academia' and public.has_org_role(v_uid, _organization_id, 'gestor'))) then
    raise exception 'Sem permissão para retirar este aviso.' using errcode = '42501';
  end if;

  update public.organizacao_encerramentos
     set etapa = 'retirado', retirado_em = now(), retirado_por = v_uid
   where id = v_enc.id;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select v_uid, u.email, 'organizacao.encerramento_retirado', 'organizacao_encerramentos', v_enc.id, v_enc.organizacao_nome,
         jsonb_build_object('iniciativa', v_enc.iniciativa, 'termino_em', v_enc.termino_em)
    from (select 1) um left join auth.users u on u.id = v_uid;
end;
$$;
revoke execute on function public.retirar_encerramento_organizacao(uuid) from public, anon;
grant execute on function public.retirar_encerramento_organizacao(uuid) to authenticated;

-- O que a tela precisa saber, para quem é da academia (equipe ou aluno) e para a ArkeFit.
create or replace function public.get_encerramento_organizacao(_organization_id uuid)
returns table (etapa text, iniciativa text, termino_em date, eliminacao_em date, motivo text)
language sql
stable
security definer
set search_path = public
as $$
  select e.etapa, e.iniciativa, e.termino_em, e.eliminacao_em,
         -- O motivo é conversa entre a academia e a ArkeFit: aluno não vê.
         case when public.has_org_role(auth.uid(), _organization_id, 'gestor')
                or public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')
              then e.motivo end
    from public.organizacao_encerramentos e
   where e.organization_id = _organization_id
     and e.etapa in ('aviso', 'encerrada')
     and (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')
          or exists (select 1 from public.organization_members m
                      where m.organization_id = _organization_id and m.user_id = auth.uid() and m.status = 'active')
          or exists (select 1 from public.alunos a
                      where a.organization_id = _organization_id and a.user_id = auth.uid()));
$$;
revoke execute on function public.get_encerramento_organizacao(uuid) from public, anon;
grant execute on function public.get_encerramento_organizacao(uuid) to authenticated;

-- ── Execução (service_role) ─────────────────────────────────────────────────

-- O que venceu hoje: aviso cujo término chegou, e encerrada cuja eliminação chegou.
create or replace function public.encerramentos_vencidos()
returns table (id uuid, organization_id uuid, proxima text, organizacao_nome text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.organization_id,
         case e.etapa when 'aviso' then 'termino' else 'eliminacao' end,
         e.organizacao_nome
    from public.organizacao_encerramentos e
   where e.organization_id is not null
     and ((e.etapa = 'aviso' and e.termino_em <= current_date)
          or (e.etapa = 'encerrada' and e.eliminacao_em <= current_date))
   order by e.solicitado_em;
$$;

-- Término: a organização vira `cancelado`, a nota fiscal automática para e as
-- digitais saem das catracas. As cobranças já foram canceladas no Asaas pela
-- edge function antes desta chamada — é ela que fala com o gateway.
create or replace function public.concluir_termino_organizacao(_encerramento_id uuid, _cobrancas_canceladas integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
  v_remocoes integer := 0;
  r record;
begin
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id and etapa = 'aviso';
  if v_enc.id is null then
    raise exception 'Encerramento não está em aviso.' using errcode = 'P0002';
  end if;

  update public.organizations set status = 'cancelado' where id = v_enc.organization_id;
  update public.organizacao_fiscal set emissao_ativa = false where organization_id = v_enc.organization_id;

  -- Matrícula que terminou leva a digital junto (Política §7): uma remoção
  -- por aluno com número na catraca, pelo mesmo caminho da revogação.
  for r in
    select a.id, a.identificador_catraca,
           exists (select 1 from public.aluno_consentimento_biometrico c
                    where c.aluno_id = a.id and c.revogado_em is null) as biometria
      from public.alunos a
     where a.organization_id = v_enc.organization_id
       and a.identificador_catraca is not null
  loop
    v_remocoes := v_remocoes + public.agendar_remocao_equipamento(
      v_enc.organization_id, r.id, r.identificador_catraca, r.biometria, 'Encerramento da academia');
  end loop;

  update public.organizacao_encerramentos
     set etapa = 'encerrada', encerrada_em = now(), cobrancas_canceladas = _cobrancas_canceladas,
         remocoes_agendadas = v_remocoes, erro = null
   where id = _encerramento_id;

  insert into public.auditoria_acoes_sensiveis (acao, entidade, entidade_id, organizacao_nome, detalhes)
  values ('organizacao.encerrada', 'organizacao_encerramentos', _encerramento_id, v_enc.organizacao_nome,
          jsonb_build_object('cobrancas_canceladas', _cobrancas_canceladas, 'remocoes_agendadas', v_remocoes,
                             'eliminacao_em', v_enc.eliminacao_em));
  return v_remocoes;
end;
$$;

-- Eliminação, parte do banco: guarda o arquivo fiscal da ArkeFit e devolve as
-- contas que só existiam nesta academia (a edge function apaga no Auth). Não
-- apaga a organização: isso é `eliminar_organizacao`, depois dos arquivos.
create or replace function public.preparar_eliminacao_organizacao(_encerramento_id uuid)
returns table (user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
  v_org record;
  v_fiscais integer;
begin
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id and etapa = 'encerrada';
  if v_enc.id is null then
    raise exception 'Encerramento não está encerrado.' using errcode = 'P0002';
  end if;
  select id, nome, cnpj_cpf into v_org from public.organizations where id = v_enc.organization_id;

  -- Refeito do zero a cada tentativa: uma eliminação que falhou no meio e roda de novo não duplica.
  delete from public.arquivo_fiscal_arkefit where organization_id = v_org.id;
  insert into public.arquivo_fiscal_arkefit (organization_id, organizacao_nome, organizacao_documento, origem,
                                             asaas_payment_id, data_pagamento, valor_cobrado, valor_arkefit, taxa_gateway)
  select v_org.id, v_org.nome, v_org.cnpj_cpf, 'b2b', b.asaas_payment_id, b.data_pagamento, b.valor, b.valor, b.taxa_gateway
    from public.cobrancas_b2b b where b.organization_id = v_org.id and b.status = 'confirmado'
  union all
  select v_org.id, v_org.nome, v_org.cnpj_cpf, 'metodo', p.asaas_payment_id, p.data_pagamento, p.valor, coalesce(p.valor_repasse_arke, 0), p.taxa_gateway
    from public.pagamentos p where p.organization_id = v_org.id and p.status = 'confirmado'
  union all
  select v_org.id, v_org.nome, v_org.cnpj_cpf, 'plano', m.asaas_payment_id, m.data_pagamento, m.valor, coalesce(m.valor_repasse_arke, 0), m.taxa_gateway
    from public.mensalidades m where m.organization_id = v_org.id and m.status = 'confirmado' and m.asaas_payment_id is not null
  union all
  select v_org.id, v_org.nome, v_org.cnpj_cpf, 'avulsa', c.asaas_payment_id, c.data_pagamento, c.valor, coalesce(c.valor_repasse_arke, 0), c.taxa_gateway
    from public.cobrancas_avulsas c where c.organization_id = v_org.id and c.status = 'confirmado';
  get diagnostics v_fiscais = row_count;

  -- A digital já foi agendada para sair no término. Sem o número, apagar o
  -- aluno junto com a organização não agenda de novo para catracas que
  -- também estão sendo apagadas.
  update public.alunos set identificador_catraca = null where organization_id = v_org.id;

  update public.organizacao_encerramentos set registros_fiscais = v_fiscais where id = _encerramento_id;

  -- Conta que só existia aqui: sem vínculo ativo noutra organização, sem
  -- matrícula noutra academia e sem papel da ArkeFit.
  return query
  select distinct u.uid
    from (
      select m.user_id as uid from public.organization_members m where m.organization_id = v_org.id
      union
      select a.user_id from public.alunos a where a.organization_id = v_org.id
    ) u
   where u.uid is not null
     and not exists (select 1 from public.organization_members m2
                      where m2.user_id = u.uid and m2.organization_id <> v_org.id and m2.status = 'active')
     and not exists (select 1 from public.alunos a2 where a2.user_id = u.uid and a2.organization_id <> v_org.id)
     and not public.has_role(u.uid, 'superadmin')
     and not public.has_role(u.uid, 'admin_arke');
end;
$$;

-- Eliminação, última parte: a organização sai, e tudo o que é dela em cascata.
create or replace function public.eliminar_organizacao(_encerramento_id uuid, _arquivos integer, _contas integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
begin
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id and etapa = 'encerrada';
  if v_enc.id is null then
    raise exception 'Encerramento não está encerrado.' using errcode = 'P0002';
  end if;

  delete from vault.secrets where name = 'asaas_subconta:' || v_enc.organization_id::text;
  delete from public.organizations where id = v_enc.organization_id;

  update public.organizacao_encerramentos
     set etapa = 'eliminada', eliminada_em = now(), arquivos_apagados = _arquivos, contas_apagadas = _contas, erro = null
   where id = _encerramento_id;

  insert into public.auditoria_acoes_sensiveis (acao, entidade, entidade_id, organizacao_nome, detalhes)
  values ('organizacao.eliminada', 'organizacao_encerramentos', _encerramento_id, v_enc.organizacao_nome,
          jsonb_build_object('arquivos_apagados', _arquivos, 'contas_apagadas', _contas,
                             'registros_fiscais', v_enc.registros_fiscais));
end;
$$;

-- Falha num passo fica no registro, com tentativa contada, para a Visão Master mostrar.
create or replace function public.registrar_falha_encerramento(_encerramento_id uuid, _erro text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.organizacao_encerramentos
     set erro = left(_erro, 500), tentativas = tentativas + 1
   where id = _encerramento_id;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.encerramentos_vencidos()',
    'public.concluir_termino_organizacao(uuid, integer)',
    'public.preparar_eliminacao_organizacao(uuid)',
    'public.eliminar_organizacao(uuid, integer, integer)',
    'public.registrar_falha_encerramento(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

grant select on public.organizacao_encerramentos to authenticated;
grant select on public.arquivo_fiscal_arkefit to authenticated;
grant all on public.organizacao_encerramentos, public.arquivo_fiscal_arkefit to service_role;

-- De hora em hora, aos 40 minutos: a maior parte das rodadas não acha nada
-- vencido. Uma academia grande não cabe numa rodada (cancelar mil assinaturas
-- no Asaas leva mais que o limite de uma edge function), e cada rodada
-- continua de onde a anterior parou.
select cron.schedule(
  'arke-encerramentos',
  '40 * * * *',
  $cron$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/encerramento-organizacao',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token', (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
  $cron$
);
