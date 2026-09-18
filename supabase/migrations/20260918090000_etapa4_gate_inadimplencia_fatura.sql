-- =====================================================================
-- ARKE — ETAPA 4: Motor Financeiro & Webhook Asaas
--
-- O webhook (asaas-webhook) e o split na criação da assinatura
-- (asaas-create-subscription) já existiam da Fase 5. O que falta para
-- fechar a Etapa 4:
--
-- 1. Guardar o link da fatura pendente (invoiceUrl do Asaas) para o
--    App do Aluno poder redirecionar para quitação quando inadimplente.
-- 2. RLS: o próprio aluno precisa conseguir ler o status/fatura da sua
--    assinatura (hoje só staff/admin_arke liam `aluno_assinaturas`).
-- =====================================================================

alter table public.aluno_assinaturas
  add column fatura_pendente_url text;

alter table public.pagamentos
  add column invoice_url text;

create policy "aluno vê a própria assinatura"
  on public.aluno_assinaturas for select to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));
