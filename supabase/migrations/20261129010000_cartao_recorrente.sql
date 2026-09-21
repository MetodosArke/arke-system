-- Cobrança recorrente no cartão para a assinatura do Método ARKE.
--
-- Até aqui a assinatura nascia com billingType UNDEFINED: todo mês o aluno
-- recebia a fatura e escolhia boleto, PIX ou cartão na página do Asaas — e
-- todo mês tinha que lembrar de pagar. É a porta de entrada da evasão
-- involuntária, a que o produto existe para reduzir: o aluno não desistiu,
-- só esqueceu, e a mensalidade vence.
--
-- O cartão vai direto à assinatura (`PUT /v3/subscriptions/{id}/creditCard`) e
-- o Asaas cobra os meses seguintes sozinho. Tokenização não é necessária para
-- isso: ela serviria para reusar o mesmo cartão em cobranças diferentes, e o
-- ARKE tem uma assinatura por aluno.
--
-- ## O que o banco guarda, e o que nunca guarda
--
-- O número do cartão atravessa a edge function `asaas-cartao-assinatura` a
-- caminho do Asaas — a API dele exige a chave secreta, então não há como o
-- navegador falar direto. Isso põe o ARKE no escopo do PCI DSS, e a resposta
-- é o cartão ser **só de passagem**: a função não grava, não registra em log
-- e não devolve número, validade nem código de segurança.
--
-- Aqui ficam apenas os 4 últimos dígitos e a bandeira — o suficiente para a
-- tela dizer "cartão final 4242" e a equipe reconhecer qual cartão está em
-- uso. A checagem abaixo recusa qualquer coisa que não sejam exatamente 4
-- dígitos, para ninguém gravar o número inteiro aqui por engano. O token do
-- Asaas também não é guardado: ele não é necessário para a recorrência, e
-- dado que não existe não vaza.

alter table public.aluno_assinaturas
  add column if not exists forma_pagamento text not null default 'fatura',
  add column if not exists cartao_final text,
  add column if not exists cartao_bandeira text,
  add column if not exists cartao_atualizado_em timestamptz,
  add column if not exists cartao_atualizado_por uuid references auth.users(id) on delete set null,
  add column if not exists cartao_recusado_em timestamptz;

alter table public.aluno_assinaturas
  drop constraint if exists aluno_assinaturas_forma_pagamento_check,
  add constraint aluno_assinaturas_forma_pagamento_check check (forma_pagamento in ('fatura', 'cartao')),
  drop constraint if exists aluno_assinaturas_cartao_final_check,
  add constraint aluno_assinaturas_cartao_final_check check (cartao_final is null or cartao_final ~ '^\d{4}$');

comment on column public.aluno_assinaturas.forma_pagamento is
  '''fatura'': o aluno paga cada mês pela página do Asaas. ''cartao'': o Asaas cobra o cartão sozinho a cada ciclo.';
comment on column public.aluno_assinaturas.cartao_final is
  'Só os 4 últimos dígitos, para identificação. Número, validade e código de segurança nunca são gravados.';
comment on column public.aluno_assinaturas.cartao_recusado_em is
  'Última recusa na cobrança recorrente (webhook PAYMENT_CREDIT_CARD_CAPTURE_REFUSED). Limpa quando um pagamento confirma ou o cartão é trocado.';

create index if not exists idx_aluno_assinaturas_cartao_atualizado_por
  on public.aluno_assinaturas (cartao_atualizado_por);

-- Recusa na cobrança recorrente vira tarefa da equipe. É o momento exato da
-- evasão involuntária: o aluno quer continuar e o cartão falhou — venceu,
-- estourou o limite, foi trocado. Quanto antes alguém fala com ele, maior a
-- chance de a mensalidade entrar antes de vencer e o acesso ser cortado.
-- Idempotente por origem_evento, como as outras tarefas automáticas.
create or replace function public.abrir_tarefa_cartao_recusado(_aluno_assinatura_id uuid, _asaas_payment_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    a.organization_id,
    a.aluno_id,
    'Cartão recusado na mensalidade do Método ARKE'
      || coalesce(' (final ' || a.cartao_final || ')', '')
      || ' — falar com o aluno para atualizar o cartão ou pagar pela fatura antes do vencimento',
    'alta',
    now() + interval '24 hours',
    'cartao_recusado:' || coalesce(_asaas_payment_id, a.id::text),
    'cobranca'
  from public.aluno_assinaturas a
  where a.id = _aluno_assinatura_id
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

revoke execute on function public.abrir_tarefa_cartao_recusado(uuid, text) from public, anon, authenticated;
grant execute on function public.abrir_tarefa_cartao_recusado(uuid, text) to service_role;
