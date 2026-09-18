# Manual do Super Admin Master — ArkeFit

> Painel: `/superadmin` · Papel exigido: `superadmin` (papel global, não vinculado a nenhuma organização)
> Público-alvo: equipe interna da ARKE responsável pela operação comercial e técnica da plataforma.

## Sumário

1. [Visão geral do painel](#1-visão-geral-do-painel)
2. [Onboarding de Tenants](#2-onboarding-de-tenants)
3. [Asaas & Split de Pagamento](#3-asaas--split-de-pagamento)
4. [Controladoria & Health Score](#4-controladoria--health-score)
5. [Governança & LGPD](#5-governança--lgpd)

---

## 1. Visão geral do painel

O `/superadmin` é a "Visão Master ArkeFit" — o único lugar do sistema que enxerga todas as organizações (tenants) ao mesmo tempo. Ele é servido por `SuperAdminDashboard.tsx` e cobre três blocos:

- **KPIs globais** (MRR, ARR, take-rate, inadimplência, retenção de tenants) — seção [Controladoria](#4-controladoria--health-score).
- **Gestão de Tenants** — busca, filtros, onboarding assistido e ações de suporte por academia/studio — seção [Onboarding de Tenants](#2-onboarding-de-tenants).
- **Simulação de Visão de Perfil** — permite ao superadmin "entrar" na sessão de um usuário real já cadastrado (aluno, gestor de academia/studio, personal ou nutricionista) para testar e validar exatamente o que aquele perfil enxerga, sem saber a senha de ninguém. Usa a Edge Function `impersonar-perfil` e nunca expõe a senha do usuário simulado. O banner amarelo "Modo simulação" aparece em qualquer tela enquanto a simulação está ativa; clicar em "Voltar para Admin" restaura a sessão original.

O acesso é controlado por `ProtectedRoute` (rota `/superadmin` exige `requiredRoles=["superadmin"]`) e, no banco, pelas próprias funções RPC do painel, que checam `has_role(auth.uid(), 'superadmin')` internamente antes de retornar qualquer dado — mesmo que alguém consiga chamar a função diretamente via API, ela recusa (`raise exception`) se o chamador não for superadmin.

## 2. Onboarding de Tenants

### 2.1 Cadastro assistido de uma nova academia/studio

Na seção "Gestão de Tenants", clique em **"+ Nova Organização"**. O modal "Cadastrar Academia / Studio" pede:

| Campo | Observação |
|---|---|
| Tipo | `Academia` ou `Studio` — Studio ganha a tela de Agenda/turmas fechadas com horário e capacidade; Academia é livre acesso |
| Nome da Unidade | Nome comercial exibido em todo o painel |
| Slug | Gerado automaticamente a partir do nome (normalizado — sem acento, minúsculo, hífens), mas editável. Define o link público de auto-matrícula: `arkefit.com.br/#/p/<slug>` |
| E-mail do Gestor Principal / Nome do Gestor | Usados para o convite de ativação |
| Plano | `Starter`, `Growth`, `Enterprise` ou `Custom` — plano B2B da plataforma (ver [Estrutura Comercial](#nota-plano-b2b-vs-nível-de-atacado) abaixo) |
| Status | `Trial` ou `Ativo` |

Ao confirmar, a Edge Function **`criar-organizacao-superadmin`**:

1. Valida todos os campos (tipo, e-mail, plano, status) e normaliza o slug.
2. Insere a linha em `organizations` (com `plano_b2b`, `tipo`, `status` escolhidos).
3. Convida o gestor por e-mail via `auth.admin.inviteUserByEmail` — **nunca gera nem expõe senha temporária**; o próprio Supabase Auth envia o link de definição de senha.
4. Cria o `profile` e o vínculo em `organization_members` com `role = "gestor"`.
5. Se qualquer etapa falhar depois da criação da organização, a função faz **rollback explícito** (deleta o usuário convidado e/ou a organização) — não fica organização "pela metade" no banco.

Se o slug já existir, a função retorna erro 409 explicando o conflito, sem tentar adivinhar um slug alternativo.

#### Nota: plano B2B vs. nível de atacado

São dois conceitos diferentes no schema, não confundir:

- **`plano_b2b`** (`starter | growth | enterprise | custom | autonomo`): quanto a academia paga à ARKE **pela plataforma** (assinatura mensal fixa, R$ 390/790/1.290 ou sob consulta — ver `CLAUDE.md` para a tabela completa).
- **`nivel_atacado`** (`essencial | integrado | elite`): o pacote que **cada aluno** contrata dentro da academia (Treino / Treino+Nutrição / Acompanhamento 360°), com custo de atacado pago pela academia à ARKE e markup livre definido pela própria academia em `/admin/organizacao`.

### 2.2 Busca, filtros e edição de um tenant existente

A tabela "Gestão de Tenants" tem busca por nome/slug e filtros por Tipo (Academia/Studio/Profissional Autônomo) e Status. Cada linha mostra Alunos, MRR, assinaturas atrasadas, Plano master, Status e **Última Atividade** (a data mais recente entre um check-in ou um treino criado na organização — é o indicador de health score para identificar contas inativas antes do churn).

O menu de ações (ícone ⋮) por tenant oferece:

- **Editar Informações do Tenant**: altera nome, tipo de negócio e plano master (update direto via RLS `"superadmin gerencia organizations"` — sem Edge Function).
- **Resetar Token do Gateway Local**: gera um novo `device_token` para **todas** as catracas da organização (via RPC `superadmin_resetar_tokens_gateway`, restrita a `service_role`). Ação irreversível e exige confirmação — os leitores físicos da academia param de autenticar até alguém reconfigurar o `config.json` do Gateway Local no local com o novo token (ver [Manual do Gateway Local](MANUAL_GATEWAY_LOCAL.md)).
- **Alterar E-mail do Gestor Master**: troca o e-mail de login do gestor ativo mais antigo da organização, via `auth.admin.updateUserById` (Admin API — exige a Edge Function `superadmin-suporte-tenant`, pois e-mail vive em `auth.users`, não em `profiles`).
- **Suspender/Ativar acesso do tenant**: bloqueia (ou libera) o login de gestor, equipe e alunos da organização inteira. Exige confirmação explícita.

Todas essas ações exigem papel `superadmin` — a Edge Function e o RPC checam isso antes de qualquer efeito colateral.

## 3. Asaas & Split de Pagamento

O split acontece no momento da cobrança da assinatura do aluno, sem intervenção manual do superadmin em cada transação — a configuração é feita uma vez por organização:

1. **Wallet ID**: cada academia configura sua própria Wallet ID do Asaas em `/admin/organizacao` (campo "Split de Pagamento (Asaas)", coluna `organizations.asaas_wallet_id`). É para lá que cai o valor líquido de cada cobrança.
2. **Criação da assinatura**: a Edge Function `asaas-create-subscription` cria a cobrança recorrente no Asaas com `billingType: "UNDEFINED"` — ou seja, o **checkout é transparente**: o próprio aluno escolhe PIX, Boleto ou Cartão na hora de pagar, sem a ARKE nem a academia pré-decidirem a forma de pagamento.
3. **Matriz de repasse** (aplicada automaticamente pelo Asaas no split configurado na cobrança):
   - `valor_repasse_arke` = `planos_atacado.custo_mensal` do nível contratado (R$ 15/45/85) → conta da ARKE.
   - `valor_liquido_academia` = `valor_total_cobrado - valor_repasse_arke` → Wallet ID da academia.
4. **Webhook** (`asaas-webhook`): recebe os eventos de pagamento do Asaas e atualiza `pagamentos`/`aluno_assinaturas`. Eventos tratados:
   - `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` → assinatura `ativa`.
   - `PAYMENT_OVERDUE` → assinatura `atrasada` (dispara o gate de inadimplência: a catraca passa a negar acesso e o app do aluno mostra o link da fatura pendente).
   - `PAYMENT_REFUNDED` / `PAYMENT_DELETED` / `PAYMENT_CHARGEBACK_REQUESTED` → estorno.
   - Idempotência: cada evento é logado em `asaas_webhook_events` com uma chave de deduplicação (`asaas_event_id`, ou `event+payment.id` quando o Asaas não fornece um id de evento estável); um evento já processado não repete efeitos colaterais mesmo se o Asaas reenviar o webhook.

### 3.1 Take-rate e conciliação

O take-rate global (repasse ARKE ÷ receita bruta) aparece no card "Take Rate" da tela `/superadmin` (RPC `get_superadmin_overview`, campo `take_rate_pct`). Para conciliação linha a linha, a tabela `pagamentos` já guarda `valor`, `valor_repasse_arke` e `valor_liquido_academia` por cobrança — não é necessário recalcular manualmente.

### 3.2 Pendência conhecida

As secrets `ASAAS_API_KEY` e `ASAAS_WEBHOOK_SECRET` precisam estar configuradas no projeto Supabase (Edge Functions → Secrets) para o split funcionar em produção. Enquanto não configuradas, `asaas-create-subscription` e `asaas-webhook` retornam erro claro em vez de falhar silenciosamente.

## 4. Controladoria & Health Score

### 4.1 KPIs globais — `/superadmin`

O topo do painel chama a RPC `get_superadmin_overview()` (SECURITY DEFINER, checa `has_role(auth.uid(),'superadmin')` internamente) e mostra:

| Card | Origem |
|---|---|
| MRR Global | Soma de `aluno_assinaturas.valor_cobrado` com `status = 'ativa'`, em todas as organizações |
| ARR Global | MRR Global × 12 |
| Take Rate | Repasse ARKE ÷ receita bruta, em % |
| Inadimplência Geral | % de assinaturas com `status = 'atrasada'` |
| Retenção de tenants | % de organizações sem cancelamento no período — é o "Health Score B2B" |
| Academias ativas / Alunos ativos / Prescrições B.A.S.E.® / Check-ins M.A.P.A.® | Contagens agregadas globais |

### 4.2 Health Score por tenant

A coluna **"Última Atividade"** na tabela de tenants (`get_superadmin_tenants`, campo `ultima_atividade`) é a maior data entre o último check-in e o último treino criado naquela organização — use-a para identificar contas silenciosamente inativas antes de virarem churn, mesmo que a assinatura B2B ainda esteja em dia.

### 4.3 Churn e LTV por organização

Métricas de churn granulares por organização vivem em dois lugares, não no painel `/superadmin`:

- **View `org_churn_metrics`** (`security_invoker`, respeita o RLS de quem consulta): alunos por fase da jornada (M.A.P.A.®/B.A.S.E.®/R.O.T.A.®/A.P.E.X.®/L.E.G.A.D.O.®), assinaturas ativas, cancelamentos do mês corrente e constância de treino nos últimos 7 dias.
- **`/admin/gestao-360`** (nível gestor, não superadmin): calcula e exibe o **DRE Simplificado** e o **LTV estimado** (ARPU ÷ % de churn do período) daquela organização específica, com exportação em PDF/Excel.

Não existe hoje um agregador de LTV *global* (todas as organizações somadas) no `/superadmin` — para uma visão consolidada, seria necessário rodar essa mesma fórmula (ARPU/churn) sobre o MRR Global e a taxa de cancelamento globais.

## 5. Governança & LGPD

### 5.1 Anonimização (soft delete) de alunos

Quando um aluno pede exclusão de dados (ou encerra vínculo definitivamente), o gestor da academia (ou admin_arke) usa a ação de anonimização em `/admin/alunos`, que chama a Edge Function **`anonimizar-aluno`**. Ela:

1. Confirma que o aluno existe e ainda não foi anonimizado (`anonimizado_em is null`) — idempotente, recusa repetir a operação.
2. Autoriza apenas `admin_arke` ou o gestor **da mesma organização** do aluno.
3. **Nunca apaga** o registro nem os dados financeiros (`aluno_assinaturas`, `pagamentos`, IDs do Asaas) — eles precisam sobreviver para auditoria fiscal/contábil.
4. Substitui e-mail de login por `anonimizado_<id>@arkefit.local`, zera `cpf`/`phone` e o nome em `profiles`, marca o `status` do perfil e do vínculo em `organization_members` como `inactive`, e grava `alunos.anonimizado_em = now()`.

Depois de anonimizado, o registro para de aparecer em listagens ativas (filtros do app já excluem `anonimizado_em is not null`), mas o histórico financeiro permanece íntegro.

### 5.2 Auditoria de RLS e multitenancy

Toda tabela do domínio carrega `organization_id` e políticas RLS ativas desde a primeira migration (princípio "Multitenancy em Primeiro Lugar" do `CLAUDE.md`). Para auditar isso periodicamente:

- Use `mcp__Supabase__get_advisors` (tipo `security`) — o linter do Supabase aponta tabelas com RLS habilitado mas sem política (`rls_enabled_no_policy`), funções `SECURITY DEFINER` expostas sem necessidade a `anon`/`authenticated`, e proteção de senha vazada desabilitada.
- Funções RPC de superadmin (`get_superadmin_overview`, `get_superadmin_tenants`, `get_superadmin_perfis_simulaveis`, `get_superadmin_profissionais_autonomos`) são `SECURITY DEFINER` **por necessidade** (precisam ler dados de todas as organizações, o que nenhuma policy por-tenant permitiria) — mas cada uma faz sua própria checagem de papel no corpo da função antes de retornar qualquer linha. Isso é esperado e não deve ser "corrigido" revogando o acesso, só verificado.
- Dados sensíveis (anamnese, avaliação física/fotos) têm RLS restrito ao profissional vinculado ao atendimento — nunca abrir acesso amplo a essas tabelas "para facilitar" um relatório; prefira uma RPC nova, também com sua própria checagem de papel.
