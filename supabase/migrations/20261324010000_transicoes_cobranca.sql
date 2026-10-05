-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Cobrança: o status só anda pelas transições permitidas, e a data do
-- pagamento confirmado não é regravada.
--
-- O webhook do Asaas grava o status que o evento traz, e o Asaas não garante
-- a ordem de entrega. Além disso, a conferência diária e o Vigia reenviam
-- avisos guardados, que podem ser mais velhos que o estado atual. Um
-- PAYMENT_OVERDUE que chega depois da confirmação rebaixaria uma cobrança
-- paga e bloquearia quem pagou. O `soEmissao` do webhook protegia só a
-- emissão; isto protege todas as transições, venha o UPDATE de onde vier.
--
-- A regra: o que já foi pago, estornado ou cancelado não volta a dever
-- (pendente ou atrasado), e o que foi pago não vira cancelado (estorno é
-- outro status). A transição recusada mantém o status anterior em silêncio:
-- o aviso continua registrado no log de webhooks, com o que trouxe.
--
-- A data do pagamento confirmado também fica: no cartão, o Asaas manda o
-- PAYMENT_CONFIRMED e, uns 30 dias depois, o PAYMENT_RECEIVED, e a receita é
-- contada pelo mês dessa data.

create or replace function public.manter_transicao_de_cobranca()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status::text is distinct from old.status::text and (
       (old.status::text in ('confirmado', 'estornado', 'cancelado') and new.status::text in ('pendente', 'atrasado'))
    or (old.status::text = 'confirmado' and new.status::text = 'cancelado')
  ) then
    new.status := old.status;
    new.data_pagamento := old.data_pagamento;
  end if;
  if old.status::text = 'confirmado' and new.status::text = 'confirmado' and old.data_pagamento is not null then
    new.data_pagamento := old.data_pagamento;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transicao_cobranca on public.pagamentos;
create trigger trg_transicao_cobranca before update of status, data_pagamento on public.pagamentos
  for each row execute function public.manter_transicao_de_cobranca();
drop trigger if exists trg_transicao_cobranca on public.mensalidades;
create trigger trg_transicao_cobranca before update of status, data_pagamento on public.mensalidades
  for each row execute function public.manter_transicao_de_cobranca();
drop trigger if exists trg_transicao_cobranca on public.cobrancas_avulsas;
create trigger trg_transicao_cobranca before update of status, data_pagamento on public.cobrancas_avulsas
  for each row execute function public.manter_transicao_de_cobranca();
drop trigger if exists trg_transicao_cobranca on public.cobrancas_b2b;
create trigger trg_transicao_cobranca before update of status, data_pagamento on public.cobrancas_b2b
  for each row execute function public.manter_transicao_de_cobranca();

revoke execute on function public.manter_transicao_de_cobranca() from public, anon, authenticated;

-- A cobrança B2B não aceitava `cancelado`, e o webhook grava esse status
-- quando o Asaas apaga a cobrança (PAYMENT_DELETED, por exemplo na pausa da
-- mensalidade do encerramento). A gravação falhava em silêncio. A inadimplência
-- B2B conta só `pendente` e `atrasado`, então `cancelado` não vira dívida.
alter table public.cobrancas_b2b drop constraint if exists cobrancas_b2b_status_check;
alter table public.cobrancas_b2b add constraint cobrancas_b2b_status_check
  check (status = any (array['pendente', 'confirmado', 'atrasado', 'estornado', 'cancelado', 'erro']));

-- A tarefa de cobrança atrasada só abre se a cobrança está de fato atrasada.
-- Com a transição recusada acima, um PAYMENT_OVERDUE velho deixa a cobrança
-- paga como paga; sem esta condição, ele ainda abriria uma tarefa de cobrar
-- quem já pagou.
create or replace function public.abrir_tarefa_avulsa_atrasada(_cobranca_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    c.organization_id,
    c.aluno_id,
    'Cobrança avulsa atrasada: ' || c.descricao || ' (venceu em ' || to_char(c.vencimento, 'DD/MM/YYYY') || ')',
    'media',
    now() + interval '48 hours',
    'avulsa_atrasada:' || c.id::text,
    'cobranca'
  from public.cobrancas_avulsas c
  where c.id = _cobranca_id
    and c.status = 'atrasado'
  on conflict (organization_id, origem_evento) do nothing;
end;
$function$;

create or replace function public.abrir_tarefa_mensalidade_atrasada(_mensalidade_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    men.organization_id,
    men.aluno_id,
    'Mensalidade da academia atrasada (venceu em ' || to_char(men.vencimento, 'DD/MM/YYYY') || ')',
    'alta',
    now() + interval '24 hours',
    'mensalidade_atrasada:' || men.id::text,
    'cobranca'
  from public.mensalidades men
  where men.id = _mensalidade_id
    and men.status = 'atrasado'
  on conflict (organization_id, origem_evento) do nothing;
end;
$function$;
