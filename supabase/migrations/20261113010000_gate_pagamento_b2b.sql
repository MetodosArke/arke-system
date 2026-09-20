-- Gate de pagamento B2B: bloqueia a equipe da academia quando há cobrança
-- da ARKE emitida e vencida sem confirmação.
--
-- Regras de negócio decididas:
--   - O gatilho é "emitida e vencida", não "nunca pagou". Cliente que ainda
--     não foi cobrado continua acessando — bloquear quem nunca recebeu
--     cobrança seria defeito, não política.
--   - O bloqueio atinge só a EQUIPE (gestor, professor, nutricionista). Os
--     alunos seguem treinando: o contrato B2B é com a academia, e o aluno
--     que pagou a mensalidade dele não deu causa ao atraso. A inadimplência
--     do aluno é tratada à parte, pelo AlunoBillingGate.
--   - Organização em `trial` não é cliente comercial: o trial existe só para
--     o Super Admin homologar. Nunca bloqueia.

-- ---------------------------------------------------------------------
-- Vencimento local
-- ---------------------------------------------------------------------
-- asaas-emitir-cobranca-b2b manda `dueDate: hojeISO()` ao Asaas mas não
-- guardava a data aqui. Sem ela, "vencida" dependeria exclusivamente de o
-- webhook PAYMENT_OVERDUE ter chegado — e um webhook perdido viraria acesso
-- liberado indefinidamente. Com a data no banco, a regra se sustenta sozinha.
alter table public.cobrancas_b2b
  add column if not exists vencimento date;

comment on column public.cobrancas_b2b.vencimento is
  'Data de vencimento enviada ao Asaas na emissão. Permite avaliar atraso sem depender da entrega do webhook.';

-- Backfill: as cobranças existentes foram emitidas com vencimento no próprio
-- dia da criação (dueDate = hoje, na Edge Function).
update public.cobrancas_b2b
   set vencimento = created_at::date
 where vencimento is null;

-- Default em vez de campo explícito na Edge Function de propósito: a regra de
-- bloqueio passa a valer para qualquer caminho de inserção, sem depender de
-- alguém lembrar de preencher a coluna nem de um redeploy da função.
-- `current_date` reproduz o mesmo `dueDate: hojeISO()` mandado ao Asaas.
alter table public.cobrancas_b2b
  alter column vencimento set default current_date;

alter table public.cobrancas_b2b
  alter column vencimento set not null;

-- ---------------------------------------------------------------------
-- Regra única de inadimplência B2B
-- ---------------------------------------------------------------------
create or replace function public.organizacao_inadimplente_b2b(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cobrancas_b2b c
    where c.organization_id = _organization_id
      and c.status <> 'confirmado'
      and (
        -- Asaas confirmou o atraso.
        c.status = 'atrasado'
        -- Ou o vencimento passou e nada confirmou o pagamento (rede de
        -- segurança para webhook atrasado ou perdido).
        or (c.vencimento is not null and c.vencimento < current_date)
      )
  );
$$;

comment on function public.organizacao_inadimplente_b2b(uuid) is
  'True quando a organização tem cobrança da ARKE emitida e vencida sem confirmação de pagamento.';

-- Regra de negócio interna, não endpoint: aceita qualquer organization_id, e
-- responder por REST deixaria qualquer um consultar a situação financeira de
-- qualquer academia.
revoke all on function public.organizacao_inadimplente_b2b(uuid) from public, anon, authenticated;
grant execute on function public.organizacao_inadimplente_b2b(uuid) to service_role;

-- ---------------------------------------------------------------------
-- O que o gate da equipe consulta
-- ---------------------------------------------------------------------
create or replace function public.get_bloqueio_organizacao()
returns table (
  organization_id uuid,
  organizacao_nome text,
  bloqueada boolean,
  cobrancas_vencidas bigint,
  valor_em_aberto numeric,
  vencimento_mais_antigo date,
  invoice_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Super Admin e Admin ARKE nunca são bloqueados: são eles que resolvem a
  -- cobrança. Trancá-los junto tornaria o problema insolúvel pelo produto.
  if public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke') then
    return;
  end if;

  return query
  with orgs_equipe as (
    select o.id, o.nome, o.status
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('gestor', 'professor', 'nutricionista')
  ),
  detalhe as (
    -- Só para montar os números da tela. A decisão de bloquear vem da função
    -- acima; se este predicado divergir dela, o pior que acontece é um
    -- detalhe impreciso, não alguém bloqueado ou liberado por engano.
    select c.organization_id,
           count(*) as qtd,
           sum(c.valor) as valor,
           min(c.vencimento) as venc,
           (array_agg(c.invoice_url order by c.vencimento nulls last, c.created_at))[1] as link
    from public.cobrancas_b2b c
    join orgs_equipe oe on oe.id = c.organization_id
    where c.status <> 'confirmado'
      and (c.status = 'atrasado' or (c.vencimento is not null and c.vencimento < current_date))
    group by c.organization_id
  ),
  avaliadas as (
    select oe.id, oe.nome,
      -- Trial é ferramenta de homologação do Super Admin, não cliente
      -- comercial: não entra no gate mesmo com cobrança vencida.
      (oe.status <> 'trial' and public.organizacao_inadimplente_b2b(oe.id)) as bloqueada,
      coalesce(d.qtd, 0) as qtd,
      coalesce(d.valor, 0) as valor,
      d.venc, d.link
    from orgs_equipe oe
    left join detalhe d on d.organization_id = oe.id
  )
  select a.id, a.nome, a.bloqueada, a.qtd, a.valor, a.venc, a.link
  from avaliadas a
  -- Quem é equipe em mais de uma academia: a bloqueada manda. Sem isto, um
  -- `limit 1` arbitrário deixaria passar quem é gestor de uma unidade
  -- inadimplente só porque também tem vínculo com outra em dia.
  order by a.bloqueada desc, a.venc asc nulls last
  limit 1;
end;
$$;
