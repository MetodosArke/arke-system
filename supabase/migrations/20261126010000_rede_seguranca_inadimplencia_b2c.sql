-- Rede de segurança de inadimplência B2C — o espelho do que o B2B já tinha.
--
-- O lado B2B considera atrasada a cobrança com `status = 'atrasado'` (webhook
-- PAYMENT_OVERDUE) **ou** com `vencimento < current_date` sem confirmação. A
-- segunda condição é a rede para webhook perdido, que de outro modo viraria
-- acesso liberado indefinidamente.
--
-- O lado B2C não tinha nada disso. O AlunoBillingGate lia
-- `aluno_assinaturas.status` direto, e esse campo só muda quando um webhook
-- chega. Se o PAYMENT_OVERDUE se perde (rede, deploy, 500 nosso), nada mais
-- chega para aquela cobrança: a assinatura fica `ativa` para sempre e o aluno
-- treina de graça, em silêncio.
--
-- E o buraco era maior que o do B2B, por dois motivos:
--
--   1. `pagamentos` não tinha coluna de vencimento. Sem ela não há como
--      perguntar "esta cobrança venceu e ninguém confirmou".
--   2. PAYMENT_CREATED é ignorado de propósito pelo webhook. Como a linha em
--      `pagamentos` só nasce no primeiro evento que muda status, um
--      PAYMENT_OVERDUE perdido deixa a cobrança **sem linha nenhuma** — uma
--      rede de segurança que olhasse só para `pagamentos` não veria nada.
--
-- O (1) se resolve aqui; o (2) se resolve no `asaas-webhook`, que passa a
-- registrar a cobrança emitida como `pendente` com o vencimento do Asaas.
-- Com as duas coisas, a regra B2C fica idêntica à B2B em semântica.
--
-- Uma alternativa considerada e descartada: usar
-- `aluno_assinaturas.proxima_cobranca < current_date`. Esse campo é gravado
-- uma única vez, na criação da assinatura, e **nunca é avançado** por
-- ninguém. Usá-lo como gatilho bloquearia todo aluno um mês depois da
-- matrícula, inclusive quem está pagando em dia — trocar um vazamento de
-- receita por bloqueio de cliente adimplente seria um negócio péssimo.

-- 1) A coluna que faltava. `pagamentos` está vazia, então não há backfill.
alter table public.pagamentos
  add column if not exists vencimento date;

comment on column public.pagamentos.vencimento is
  'Data de vencimento da cobrança no Asaas (payment.dueDate). Base da rede de '
  'segurança contra webhook perdido: cobrança vencida e não confirmada bloqueia '
  'o acesso mesmo que o PAYMENT_OVERDUE nunca tenha chegado.';

-- Índice para o predicado do gate: só as cobranças ainda não confirmadas
-- interessam, e são a minoria.
create index if not exists pagamentos_aberto_vencimento_idx
  on public.pagamentos (aluno_assinatura_id, vencimento)
  where status <> 'confirmado';

-- 2) A regra, espelhando `organizacao_inadimplente_b2b`.
create or replace function public.aluno_inadimplente_b2c(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.aluno_assinaturas a
    join public.pagamentos p on p.aluno_assinatura_id = a.id
    where a.aluno_id = _aluno_id
      -- `trial` é ferramenta de homologação e `cancelada` encerrou a relação:
      -- nenhuma das duas é alguém a quem cobrar acesso.
      and a.status in ('ativa', 'atrasada')
      and p.status <> 'confirmado'
      and (
        p.status = 'atrasado'
        or (p.vencimento is not null and p.vencimento < current_date)
      )
  );
$$;

comment on function public.aluno_inadimplente_b2c(uuid) is
  'Espelho B2C de organizacao_inadimplente_b2b: cobrança emitida cujo vencimento '
  'passou sem confirmação. A segunda condição é a rede para webhook perdido.';

revoke execute on function public.aluno_inadimplente_b2c(uuid) from public, anon;
grant execute on function public.aluno_inadimplente_b2c(uuid) to authenticated;

-- 3) O que o frontend consome.
--
-- Recebe o `_aluno_id` que o app já resolveu em vez de redescobri-lo por
-- `user_id`. Uma pessoa pode ser aluna de mais de uma academia, e buscar
-- `alunos` por `user_id` com `limit 1` seria reencenar exatamente a armadilha
-- do vínculo duplo que já custou cinco defeitos neste projeto: escolha
-- arbitrária entre duas linhas legítimas. Quem decide o contexto do app é o
-- AuthContext; aqui só se confere que o aluno pedido é mesmo de quem pergunta.
create or replace function public.get_bloqueio_aluno(_aluno_id uuid)
returns table (
  aluno_id uuid,
  bloqueado boolean,
  assinatura_status text,
  cobrancas_vencidas bigint,
  valor_em_aberto numeric,
  vencimento_mais_antigo date,
  invoice_url text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Quem resolve a cobrança não pode ser trancado por ela.
  if public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke') then
    return;
  end if;

  return query
  with assinatura as (
    select a.id, a.aluno_id, a.status::text as status, a.fatura_pendente_url
    from public.aluno_assinaturas a
    join public.alunos al on al.id = a.aluno_id
    -- O `user_id` aqui não escolhe o aluno, só autoriza: sem ele, qualquer
    -- pessoa autenticada leria a situação financeira de qualquer outra.
    where al.id = _aluno_id
      and al.user_id = auth.uid()
  ),
  detalhe as (
    select p.aluno_assinatura_id,
           count(*) as qtd,
           sum(p.valor) as valor,
           min(p.vencimento) as venc,
           (array_agg(p.invoice_url order by p.vencimento nulls last, p.created_at))[1] as link
    from public.pagamentos p
    join assinatura s on s.id = p.aluno_assinatura_id
    where p.status <> 'confirmado'
      and (p.status = 'atrasado' or (p.vencimento is not null and p.vencimento < current_date))
    group by p.aluno_assinatura_id
  )
  select s.aluno_id,
         -- União dos dois sinais, como no B2B: o status que o webhook gravou
         -- **ou** a cobrança vencida que ninguém confirmou.
         (s.status in ('ativa', 'atrasada')
          and (s.status = 'atrasada' or public.aluno_inadimplente_b2c(s.aluno_id))) as bloqueado,
         s.status,
         coalesce(d.qtd, 0),
         coalesce(d.valor, 0),
         d.venc,
         -- A fatura que o webhook guardou tem precedência: é a que o Asaas
         -- considera pendente agora. O link da cobrança vencida é o reserva
         -- para quando o webhook se perdeu e não há fatura guardada.
         coalesce(s.fatura_pendente_url, d.link)
  from assinatura s
  left join detalhe d on d.aluno_assinatura_id = s.id;
end;
$$;

comment on function public.get_bloqueio_aluno(uuid) is
  'Serve o AlunoBillingGate. Devolve zero linhas para ArkeFit (nunca bloqueada), '
  'para quem não tem assinatura e para aluno que não pertence a quem pergunta.';

revoke execute on function public.get_bloqueio_aluno(uuid) from public, anon;
grant execute on function public.get_bloqueio_aluno(uuid) to authenticated;
