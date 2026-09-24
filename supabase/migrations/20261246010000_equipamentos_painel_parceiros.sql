-- Visão Master de equipamentos, alerta de catraca fora do ar e credenciais
-- de parceiro no Vault (versão 1.0, 23/09/2026).
--
-- A auditoria 360° perguntou o que falta para a ArkeFit ter controle da
-- operação. A telemetria e o canal de comandos (20261244010000) deram os
-- dados; aqui ficam as perguntas que se fazem com eles:
--
--   * quais catracas estão fora do ar agora, em qual academia, desde quando
--     — e um e-mail quando uma cai, no mesmo trilho do alerta de rotinas;
--   * o que passou pela catraca de qualquer academia, para o suporte —
--     sem nome nem CPF de aluno, e com cada consulta registrada;
--   * se a biometria está sendo tratada como a LGPD pede: quem consentiu,
--     sob qual texto, e remoção de equipamento parada.
--
-- E fecha um item de segurança que a mesma auditoria encontrou: as chaves
-- de API do Wellhub e do TotalPass ficavam em texto puro numa tabela.

-- ── O app do aluno sabe se a academia tem catraca ──────────────────────────
-- Sem isto, o aluno de academia sem catraca veria um interruptor de
-- "autorizo o uso da minha digital" — pedir consentimento para algo que não
-- existe confunde e ensina a aceitar sem ler.
create or replace function public.academia_tem_catraca(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.organizacao_catracas c
            where c.organization_id = _org and c.status = 'ativo')
     and (exists (select 1 from public.organization_members m
                   where m.organization_id = _org and m.user_id = auth.uid() and m.status = 'active')
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke'));
$$;
revoke execute on function public.academia_tem_catraca(uuid) from public, anon;
grant execute on function public.academia_tem_catraca(uuid) to authenticated;

-- ── Catraca fora do ar: o alerta ───────────────────────────────────────────
-- Só avisa Gateway 1.0 (que reporta pelo canal a cada ~20 s); o anterior só
-- dava sinal na sincronização de 5 em 5 minutos, e avisar sobre ele seria
-- ruído. Janela de horário porque o computador da academia pode ficar
-- desligado de madrugada de propósito — e um aviso que chega toda noite
-- ensina a ignorar o que chega de dia.
insert into public.plataforma_config (chave, valor, descricao) values
  ('alerta_catraca_minutos', 15,
   'Minutos sem sinal do Gateway Local até a Visão Master avisar por e-mail que a catraca de uma academia saiu do ar.'),
  ('alerta_catraca_hora_inicio', 6,
   'Hora (Brasília) a partir da qual catraca sem sinal gera aviso. Fora da janela o computador da academia pode estar desligado de propósito.'),
  ('alerta_catraca_hora_fim', 23,
   'Hora (Brasília) até a qual catraca sem sinal gera aviso.')
on conflict (chave) do nothing;

create or replace function public.avaliar_catracas()
returns table(nome text, situacao text, detalhe text, catraca_id uuid, organization_id uuid, sem_sinal_desde timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce((select valor from public.plataforma_config where chave = 'alerta_catraca_minutos'), 15)::int as minutos,
           coalesce((select valor from public.plataforma_config where chave = 'alerta_catraca_hora_inicio'), 6) as ini,
           coalesce((select valor from public.plataforma_config where chave = 'alerta_catraca_hora_fim'), 23) as fim,
           -- O fuso do banco é o de Brasília (20261221010000_fuso_brasilia).
           extract(hour from now()) as hora
  ),
  base as (
    select c.id, c.organization_id, c.nome as catraca, o.nome as academia,
           greatest(t.reportado_em, c.ultimo_heartbeat_em) as ultimo
      from public.organizacao_catracas c
      join public.organizations o on o.id = c.organization_id
      join public.gateway_telemetria t on t.catraca_id = c.id
     where c.status = 'ativo'
  )
  select 'catraca:' || b.id::text,
         case
           when b.ultimo >= now() - make_interval(mins => cfg.minutos) then 'ok'
           when (cfg.ini <= cfg.fim and cfg.hora >= cfg.ini and cfg.hora < cfg.fim)
             or (cfg.ini > cfg.fim and (cfg.hora >= cfg.ini or cfg.hora < cfg.fim)) then 'catraca_offline'
           else 'catraca_offline_fora_horario'
         end,
         b.academia || ' · ' || b.catraca ||
           case when b.ultimo >= now() - make_interval(mins => cfg.minutos) then ''
                else ': sem sinal desde ' || to_char(b.ultimo, 'DD/MM HH24:MI') end,
         b.id, b.organization_id, b.ultimo
    from base b cross join cfg;
$$;
revoke execute on function public.avaliar_catracas() from public, anon, authenticated;
grant execute on function public.avaliar_catracas() to service_role;

-- Mesmo trilho do alerta de rotinas e de capacidade: mesma faixa, mesmo
-- e-mail de hora em hora, mesmo registro de "já avisei". Um terceiro
-- mecanismo de aviso seria um terceiro lugar para esquecer de olhar.
--
-- `catraca_offline_fora_horario` não é problema (não avisa) nem
-- recuperação (não manda "voltou ao normal" só porque anoiteceu): quem caiu
-- de dia e segue fora à noite continua devendo o "voltou" de quando voltar.
create or replace function public.rotinas_para_alertar()
returns table(nome text, tipo text, situacao text, ultima_execucao timestamptz, ultimo_erro text)
language sql
stable
security definer
set search_path = public
as $$
  with atual as (
    select r.nome, r.situacao, r.ultima_execucao, r.ultimo_erro from public.avaliar_rotinas() r
    union all
    select c.nome, c.situacao, null::timestamptz, c.detalhe from public.avaliar_capacidade() c
    union all
    select k.nome, k.situacao, null::timestamptz, k.detalhe from public.avaliar_catracas() k
  ),
  problema as (
    select * from atual where situacao in ('falhou', 'atrasada', 'banco_70', 'banco_85', 'catraca_offline')
  )
  select a.nome,
         case when al.nome is null or al.situacao <> a.situacao then 'novo' else 'lembrete' end,
         a.situacao, a.ultima_execucao, a.ultimo_erro
    from problema a
    left join public.alertas_rotinas al on al.nome = a.nome
   where al.nome is null
      or al.situacao <> a.situacao
      or al.avisado_em < now() - case when a.situacao = 'banco_70' then interval '7 days' else interval '24 hours' end
  union all
  select al.nome, 'recuperou', coalesce(a.situacao, 'removida'), a.ultima_execucao,
         case when al.nome like 'capacidade:%' or al.nome like 'catraca:%' then a.ultimo_erro end
    from public.alertas_rotinas al
    left join atual a on a.nome = al.nome
   where a.nome is null
      or a.situacao not in ('falhou', 'atrasada', 'banco_70', 'banco_85', 'catraca_offline', 'catraca_offline_fora_horario');
$$;

-- ── Visão Master: os equipamentos de todas as academias ────────────────────
-- A ArkeFit não lê organizacao_catracas pelo RLS (é da academia), e não
-- deveria: o device_token de cada catraca está lá. Esta função devolve o
-- estado, nunca o token.
create or replace function public.get_superadmin_equipamentos()
returns table(
  catraca_id uuid, organization_id uuid, academia text, catraca text, status_catraca text,
  situacao text, versao text, modelo text, estado text, fila_offline integer, cache_alunos integer,
  ultima_sincronizacao timestamptz, ultimo_erro text, ultimo_erro_em timestamptz,
  equipamentos jsonb, ponte jsonb, capacidades text[], reportado_em timestamptz, ultimo_heartbeat_em timestamptz,
  comandos_pendentes integer, comandos_falhos_7d integer, acessos_hoje integer, contingencias_7d integer,
  checkins_parceiro_mes integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query
  select c.id, c.organization_id, o.nome, c.nome, c.status,
         case when c.status <> 'ativo' then 'desativada'
              else public.situacao_gateway(c.ultimo_heartbeat_em, t.reportado_em, t.estado) end,
         t.versao, t.modelo, t.estado, t.fila_offline, t.cache_alunos,
         t.ultima_sincronizacao, t.ultimo_erro, t.ultimo_erro_em,
         coalesce(t.equipamentos, '[]'::jsonb), t.ponte, coalesce(t.capacidades, '{}'::text[]),
         t.reportado_em, c.ultimo_heartbeat_em,
         (select count(*)::int from public.gateway_comandos g
           where g.catraca_id = c.id and g.status in ('pendente', 'entregue')),
         (select count(*)::int from public.gateway_comandos g
           where g.catraca_id = c.id and g.status in ('falhou', 'expirado') and g.solicitado_em > now() - interval '7 days'),
         (select count(*)::int from public.acessos_catraca_logs l
           where l.catraca_id = c.id and l.created_at >= current_date),
         (select count(*)::int from public.gateway_eventos e
           where e.catraca_id = c.id and e.tipo = 'contingencia' and e.ocorrido_em > now() - interval '7 days'),
         (select count(*)::int from public.acessos_catraca_logs l
           where l.catraca_id = c.id and l.resultado = 'liberado_parceiro_externo'
             and l.created_at >= date_trunc('month', now()))
    from public.organizacao_catracas c
    join public.organizations o on o.id = c.organization_id
    left join public.gateway_telemetria t on t.catraca_id = c.id;
end;
$$;
revoke execute on function public.get_superadmin_equipamentos() from public, anon;
grant execute on function public.get_superadmin_equipamentos() to authenticated;

-- ── Visão Master: acessos pela catraca, sem identificar o aluno ────────────
-- O suporte precisa ver o que aconteceu ("a catraca negou todo mundo das
-- 7h às 8h?"), não quem entrou. Então:
--   * nada de nome, CPF ou identificador: o aluno vira um pseudônimo estável
--     (o mesmo aluno tem o mesmo código na consulta inteira, para dar para
--     seguir um caso) que não se reverte fora do banco;
--   * a credencial aparece só pelo tipo (cpf, identificador, remoto);
--   * cada consulta fica em auditoria_acoes_sensiveis, com os filtros e
--     quantas linhas voltaram — olhar o movimento da academia de um cliente
--     é ação sensível mesmo sem nome;
--   * no máximo 31 dias e 500 linhas por consulta.
create or replace function public.get_superadmin_acessos_catraca(
  _organization_id uuid default null,
  _catraca_id uuid default null,
  _resultado text default null,
  _desde timestamptz default null,
  _ate timestamptz default null,
  _limite integer default 200
)
returns table(
  id uuid, ocorrido_em timestamptz, academia text, catraca text, resultado text, giro text,
  validado_offline boolean, credencial text, aluno_ref text, parceiro_externo text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desde timestamptz := coalesce(_desde, now() - interval '24 hours');
  v_ate timestamptz := coalesce(_ate, now());
  v_limite integer := least(greatest(coalesce(_limite, 200), 1), 500);
  v_linhas integer;
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  if v_ate - v_desde > interval '31 days' then
    raise exception 'Consulte no máximo 31 dias por vez.';
  end if;

  -- RETURN QUERY não encerra a função: devolve as linhas e segue, e é o
  -- que deixa registrar na auditoria quantas linhas a consulta devolveu.
  return query
    select l.id, l.created_at as ocorrido_em, o.nome as academia, c.nome as catraca, l.resultado, l.giro,
           l.validado_offline,
           case when l.resultado = 'liberado_parceiro_externo' then 'parceiro'
                when l.cpf_consultado = 'remoto' then 'remoto'
                when l.cpf_consultado like 'id:%' then 'identificador'
                when l.cpf_consultado is null or l.cpf_consultado = '' then 'nenhuma'
                else 'cpf' end as credencial,
           case when l.aluno_id is null then null
                else 'A-' || upper(substr(md5(l.aluno_id::text || l.organization_id::text), 1, 6)) end as aluno_ref,
           l.parceiro_externo
      from public.acessos_catraca_logs l
      join public.organizations o on o.id = l.organization_id
      left join public.organizacao_catracas c on c.id = l.catraca_id
     where l.created_at >= v_desde and l.created_at <= v_ate
       and (_organization_id is null or l.organization_id = _organization_id)
       and (_catraca_id is null or l.catraca_id = _catraca_id)
       and (_resultado is null or l.resultado = _resultado)
     order by l.created_at desc
     limit v_limite;
  get diagnostics v_linhas = row_count;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select auth.uid(), u.email, 'superadmin.consulta_acessos_catraca', 'acessos_catraca_logs', _catraca_id,
         -- Qualificado: `id` sozinho colidiria com a coluna de saída da função.
         coalesce((select o2.nome from public.organizations o2 where o2.id = _organization_id), 'todas as academias'),
         jsonb_build_object('desde', v_desde, 'ate', v_ate, 'resultado', _resultado,
                            'organization_id', _organization_id, 'linhas', v_linhas)
    from (select 1) x
    left join auth.users u on u.id = auth.uid();
end;
$$;
revoke execute on function public.get_superadmin_acessos_catraca(uuid, uuid, text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.get_superadmin_acessos_catraca(uuid, uuid, text, timestamptz, timestamptz, integer) to authenticated;

-- ── Visão Master: a biometria está sendo tratada como a LGPD pede? ─────────
-- Só contagens por academia. A ArkeFit precisa saber se há remoção parada ou
-- consentimento sob texto antigo, não de quem é a digital.
create or replace function public.get_superadmin_biometria()
returns table(
  organization_id uuid, academia text, consentimentos_vigentes integer, consentimentos_texto_antigo integer,
  alunos_com_identificador integer, revogacoes_30d integer, remocoes_em_andamento integer,
  remocoes_paradas integer, tarefas_equipamento_abertas integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query
  select o.id, o.nome,
         (select count(*)::int from public.aluno_consentimento_biometrico b
           where b.organization_id = o.id and b.revogado_em is null
             and b.versao_texto = public.versao_consentimento_biometrico()),
         (select count(*)::int from public.aluno_consentimento_biometrico b
           where b.organization_id = o.id and b.revogado_em is null
             and b.versao_texto is distinct from public.versao_consentimento_biometrico()),
         (select count(*)::int from public.alunos a
           where a.organization_id = o.id and a.identificador_catraca is not null),
         (select count(*)::int from public.aluno_consentimento_biometrico b
           where b.organization_id = o.id and b.revogado_em > now() - interval '30 days'),
         (select count(distinct coalesce(g.lote, g.id))::int from public.gateway_comandos g
           where g.organization_id = o.id and g.tipo = 'apagar_usuario' and g.status in ('pendente', 'entregue')),
         -- Revogado há mais de 24 h e ainda sem a data de exclusão do equipamento.
         (select count(*)::int from public.aluno_consentimento_biometrico b
           where b.organization_id = o.id and b.revogado_em < now() - interval '24 hours'
             and b.excluido_do_equipamento_em is null
             and not exists (select 1 from public.aluno_consentimento_biometrico n
                              where n.aluno_id = b.aluno_id and n.revogado_em is null)),
         (select count(*)::int from public.tarefas t
           where t.organization_id = o.id and t.tipo = 'equipamento' and t.status not in ('concluida', 'cancelada'))
    from public.organizations o
   where exists (select 1 from public.organizacao_catracas c where c.organization_id = o.id)
      or exists (select 1 from public.aluno_consentimento_biometrico b where b.organization_id = o.id);
end;
$$;
revoke execute on function public.get_superadmin_biometria() from public, anon;
grant execute on function public.get_superadmin_biometria() to authenticated;

-- ── Credenciais de parceiro: do texto puro para o Vault ────────────────────
-- api_key, client_secret e webhook_secret ficavam em colunas de texto,
-- legíveis pelo gestor e por qualquer backup do banco. Agora vão para o
-- Vault e a tabela guarda só que existem e os 4 últimos caracteres (quando
-- a chave é longa o bastante para isso não ajudar a adivinhá-la), para o
-- gestor conferir qual chave está configurada sem poder lê-la de volta.
-- Nenhuma linha tinha segredo em 23/09/2026 — a troca não perde nada.
--
-- As colunas antigas saem em 20261249010000, aplicada DEPOIS do deploy do
-- app: apagá-las antes quebraria a tela de Integrações ainda publicada, que
-- as lê. Até lá, a restrição abaixo impede que alguém grave segredo nelas.
alter table public.organizacao_credenciais_parceiro
  add column if not exists segredos jsonb not null default '{}'::jsonb;

alter table public.organizacao_credenciais_parceiro
  drop constraint if exists credencial_parceiro_sem_texto_puro;
alter table public.organizacao_credenciais_parceiro
  add constraint credencial_parceiro_sem_texto_puro
  check (api_key is null and client_secret is null and webhook_secret is null);

comment on column public.organizacao_credenciais_parceiro.segredos is
  'Quais segredos estão no Vault (api_key, client_secret, webhook_secret), com o final e a data. Nunca o valor.';

create or replace function public.salvar_credencial_parceiro(
  _organization_id uuid,
  _parceiro text,
  _identificador text,
  _ativo boolean,
  _segredos jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_campo text;
  v_valor text;
  v_nome text;
  v_id uuid;
  v_meta jsonb;
begin
  if not (public.has_org_role(auth.uid(), _organization_id, 'gestor') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Só o gestor da academia configura credenciais de parceiro.' using errcode = '42501';
  end if;
  if _parceiro not in ('wellhub', 'totalpass') then
    raise exception 'Parceiro desconhecido.';
  end if;

  insert into public.organizacao_credenciais_parceiro (organization_id, parceiro, identificador, ativo)
  values (_organization_id, _parceiro, nullif(btrim(coalesce(_identificador, '')), ''), coalesce(_ativo, false))
  on conflict (organization_id, parceiro) do update
     set identificador = excluded.identificador, ativo = excluded.ativo
  returning segredos into v_meta;

  -- Campo ausente: fica como está. Texto vazio: apaga. Texto: grava.
  foreach v_campo in array array['api_key', 'client_secret', 'webhook_secret'] loop
    continue when not (coalesce(_segredos, '{}'::jsonb) ? v_campo);
    v_valor := btrim(coalesce(_segredos->>v_campo, ''));
    v_nome := 'parceiro:' || _organization_id::text || ':' || _parceiro || ':' || v_campo;
    select s.id into v_id from vault.secrets s where s.name = v_nome;
    if v_valor = '' then
      if v_id is not null then
        delete from vault.secrets where id = v_id;
      end if;
      v_meta := v_meta - v_campo;
    else
      if v_id is null then
        perform vault.create_secret(v_valor, v_nome, 'Credencial de parceiro (' || _parceiro || ') da academia');
      else
        perform vault.update_secret(v_id, v_valor);
      end if;
      v_meta := v_meta || jsonb_build_object(v_campo, jsonb_build_object(
        'final', case when length(v_valor) >= 12 then right(v_valor, 4) else '' end,
        'atualizado_em', now()));
    end if;
  end loop;

  update public.organizacao_credenciais_parceiro
     set segredos = v_meta
   where organization_id = _organization_id and parceiro = _parceiro;
  return v_meta;
end;
$$;
revoke execute on function public.salvar_credencial_parceiro(uuid, text, text, boolean, jsonb) from public, anon;
grant execute on function public.salvar_credencial_parceiro(uuid, text, text, boolean, jsonb) to authenticated;

-- Para a integração automática, quando vier: só a service_role lê.
create or replace function public.ler_credencial_parceiro(_organization_id uuid, _parceiro text, _campo text)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets
   where name = 'parceiro:' || _organization_id::text || ':' || _parceiro || ':' || _campo;
$$;
revoke execute on function public.ler_credencial_parceiro(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ler_credencial_parceiro(uuid, text, text) to service_role;

-- Linha apagada (inclusive em cascata, com a organização) leva o segredo
-- junto. Sem isto, o Vault acumularia chave de academia que já saiu.
create or replace function public.apagar_segredos_parceiro()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets
   where name like 'parceiro:' || old.organization_id::text || ':' || old.parceiro || ':%';
  return old;
end;
$$;
revoke execute on function public.apagar_segredos_parceiro() from public, anon, authenticated;

drop trigger if exists trg_apagar_segredos_parceiro on public.organizacao_credenciais_parceiro;
create trigger trg_apagar_segredos_parceiro
  after delete on public.organizacao_credenciais_parceiro
  for each row execute function public.apagar_segredos_parceiro();
