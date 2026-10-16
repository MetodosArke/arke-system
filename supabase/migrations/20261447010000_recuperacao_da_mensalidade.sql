-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A recuperação da mensalidade vencida (15/10/2026).
--
-- Decisão do responsável depois de comparar com o concorrente: reduzir a
-- inadimplência sem trabalho da recepção. O Asaas já avisa por e-mail e SMS
-- (no vencimento sem pagamento e a cada 7 dias) e já tenta o cartão da
-- assinatura no vencimento. O que faltava é o que só o app tem:
--
--   1. o aviso no celular do aluno no D+1 e no D+3, dentro dos 5 dias de
--      tolerância, antes do bloqueio (rotina `arke-aviso-cobranca`, edge
--      function `aviso-cobranca-atrasada`). Cada etapa é reservada na própria
--      mensalidade antes de sair: a coluna vazia é a condição da reserva;
--   2. a tarefa de cobrança que fecha sozinha quando o pagamento entra, com o
--      desfecho dizendo se foi depois do aviso;
--   3. o número do que foi recuperado no mês, para a academia ver no
--      Financeiro.
--
-- A nova tentativa no cartão fica de fora: a API do Asaas só cobra de novo
-- uma cobrança existente com o cartão inteiro ou com um token, e o ArkeFit
-- não guarda nenhum dos dois (docs/registro/cobranca.md, 15/10/2026).

-- ── 1. A reserva de cada aviso ─────────────────────────────────────────────
alter table public.mensalidades
  add column if not exists aviso_cobranca_d1_em timestamptz,
  add column if not exists aviso_cobranca_d3_em timestamptz;

comment on column public.mensalidades.aviso_cobranca_d1_em is
  'Quando saiu o aviso no celular do D+1 da mensalidade vencida. Preenchida, o aviso não sai de novo (aviso-cobranca-atrasada).';
comment on column public.mensalidades.aviso_cobranca_d3_em is
  'Quando saiu o aviso no celular do D+3 da mensalidade vencida. Preenchida, o aviso não sai de novo (aviso-cobranca-atrasada).';

-- ── 2. Quem pode receber o aviso hoje ──────────────────────────────────────
--
-- A mesma dívida do bloqueio (`aluno_mensalidade_vencida`: lista de inclusão,
-- matrícula ativa), vencida há 1 a 5 dias, de aluno com o app liberado pela
-- situação (o pausado e o já bloqueado ficam de fora) e com aparelho
-- inscrito. A etapa de cada uma é decidida na função (regras.ts), com o teste
-- ao lado.
create or replace function public.mensalidades_para_aviso_de_cobranca()
returns table(
  mensalidade_id uuid,
  user_id uuid,
  vencimento date,
  aviso_cobranca_d1_em timestamptz,
  aviso_cobranca_d3_em timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id, al.user_id, s.vencimento, s.aviso_cobranca_d1_em, s.aviso_cobranca_d3_em
    from public.mensalidades s
    join public.aluno_matriculas_academia m on m.id = s.matricula_id
    join public.alunos al on al.id = s.aluno_id
   where s.status in ('pendente', 'atrasado')
     and s.vencimento >= current_date - 5
     and s.vencimento < current_date
     and m.status = 'ativa'
     and al.user_id is not null
     and public.situacao_permite_app(al.situacao_academia, al.situacao_academia_em)
     and exists (select 1 from public.push_subscriptions p where p.user_id = al.user_id);
$$;

comment on function public.mensalidades_para_aviso_de_cobranca() is
  'Mensalidades vencidas há 1 a 5 dias, de aluno com o app liberado e aparelho inscrito: as candidatas ao aviso no celular. Só a rotina lê.';

revoke execute on function public.mensalidades_para_aviso_de_cobranca() from public, anon, authenticated;
grant execute on function public.mensalidades_para_aviso_de_cobranca() to service_role;

-- ── 3. Paga depois do aviso ────────────────────────────────────────────────
--
-- Um lugar só para a regra, que a tarefa e o Financeiro usam: a mensalidade
-- avisada e paga no dia do primeiro aviso ou depois. A data do pagamento é a
-- do Asaas (a do aluno), e não a da confirmação: o boleto pago antes do aviso
-- e compensado depois não conta como recuperado. O mesmo dia conta: o aviso
-- sai às 10h, e o pagamento pelo toque no aviso cai no mesmo dia.
create or replace function public.paga_depois_do_aviso(
  _aviso_d1_em timestamptz,
  _aviso_d3_em timestamptz,
  _data_pagamento date
)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    _data_pagamento >= (coalesce(_aviso_d1_em, _aviso_d3_em) at time zone 'America/Sao_Paulo')::date,
    false
  );
$$;

comment on function public.paga_depois_do_aviso(timestamptz, timestamptz, date) is
  'Mensalidade avisada no celular e paga (data do Asaas) no dia do primeiro aviso ou depois.';

-- ── 4. A tarefa de cobrança fecha quando o pagamento entra ─────────────────
--
-- A fila exige desfecho, e até aqui a tarefa da mensalidade atrasada (e a do
-- cartão recusado) ficava aberta depois do pagamento, esperando alguém
-- fechar à mão. Inclusão ou alteração: a mensalidade pode nascer confirmada
-- (o upsert do webhook), como nos gatilhos da receita e da nota.
create or replace function public.fechar_tarefa_da_mensalidade_paga()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from 'confirmado' then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if old.status is not distinct from 'confirmado' then
      return null;
    end if;
  end if;

  update public.tarefas
     set status = 'concluida',
         desfecho_acao = case
           when public.paga_depois_do_aviso(new.aviso_cobranca_d1_em, new.aviso_cobranca_d3_em,
                                            coalesce(new.data_pagamento, current_date))
             then 'Pago depois do aviso automático ao aluno (confirmado pelo Asaas).'
           else 'Pago (confirmado pelo Asaas).'
         end
   where organization_id = new.organization_id
     and origem_evento in ('mensalidade_atrasada:' || new.id::text,
                           'cartao_recusado_mensalidade:' || new.asaas_payment_id)
     and status in ('aberta', 'em_andamento', 'aguardando');
  return null;
end;
$$;

drop trigger if exists trg_fechar_tarefa_da_mensalidade_paga on public.mensalidades;
create trigger trg_fechar_tarefa_da_mensalidade_paga
  after insert or update of status on public.mensalidades
  for each row execute function public.fechar_tarefa_da_mensalidade_paga();

revoke execute on function public.fechar_tarefa_da_mensalidade_paga() from public, anon, authenticated;

-- ── 5. O recuperado do mês, para o Financeiro ──────────────────────────────
--
-- `security invoker`: segue o RLS de quem pede (a gestão e a recepção da
-- academia leem as mensalidades dela; qualquer outra pessoa recebe zero).
create or replace function public.cobranca_recuperada_no_mes(_organization_id uuid, _inicio date, _fim date)
returns table(quantidade bigint, valor numeric)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select count(*), coalesce(sum(s.valor), 0)
    from public.mensalidades s
   where s.organization_id = _organization_id
     and s.status = 'confirmado'
     and s.data_pagamento between _inicio and _fim
     and public.paga_depois_do_aviso(s.aviso_cobranca_d1_em, s.aviso_cobranca_d3_em, s.data_pagamento);
$$;

comment on function public.cobranca_recuperada_no_mes(uuid, date, date) is
  'Mensalidades pagas no período depois do aviso no celular: quantas e quanto. Segue o RLS de quem pede.';

revoke execute on function public.cobranca_recuperada_no_mes(uuid, date, date) from public, anon;
grant execute on function public.cobranca_recuperada_no_mes(uuid, date, date) to authenticated;

-- ── 6. A rotina ────────────────────────────────────────────────────────────
--
-- O alerta de rotinas passa a esperar o desfecho da função (20261248010000).
insert into public.execucoes_agendadas (nome, ultima_ok) values ('aviso-cobranca-atrasada', now())
on conflict (nome) do nothing;

-- Todo dia às 13h em GMT, que é 10h em Brasília (UTC-3, sem horário de verão
-- desde 2019): dentro do horário comercial, que a função confere de novo. No
-- domingo ela só registra a rodada; a janela de cada etapa cobre o dia sem aviso.
select cron.unschedule(jobid) from cron.job where jobname = 'arke-aviso-cobranca';
select cron.schedule(
  'arke-aviso-cobranca',
  '0 13 * * *',
  $cron$
    select net.http_post(
      url := 'https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/aviso-cobranca-atrasada',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alerta-token', (select decrypted_secret from vault.decrypted_secrets where name = 'alerta_rotinas_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);
