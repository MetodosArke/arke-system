# Manual do Super Admin Master — ArkeFit

> Painel: `/superadmin` · Papel exigido: `superadmin` (papel global, não vinculado a nenhuma organização)
> Público-alvo: equipe interna da ARKE responsável pela operação comercial e técnica da plataforma.

## Sumário

1. [Visão geral do painel](#1-visão-geral-do-painel)
2. [Onboarding de Tenants](#2-onboarding-de-tenants)
3. [Asaas & Split de Pagamento](#3-asaas--split-de-pagamento)
4. [Controladoria & Health Score](#4-controladoria--health-score)
5. [Governança & LGPD](#5-governança--lgpd)
6. [E-mails Transacionais de Autenticação](#6-e-mails-transacionais-de-autenticação)

---

## 1. Visão geral do painel

O `/superadmin` é a "Visão Master ArkeFit" — o único lugar do sistema que enxerga todas as organizações (tenants) ao mesmo tempo. Tem duas telas:

- **`/superadmin`** (`SuperAdminDashboard.tsx`), com três blocos:
  - **KPIs globais** (MRR, ARR, take-rate, inadimplência, retenção de tenants) — seção [Controladoria](#4-controladoria--health-score).
  - **Gestão de Tenants** — busca, filtros, abas de carteira, onboarding assistido, edição e ações de suporte (incluindo exclusão) por academia/studio — seção [Onboarding de Tenants](#2-onboarding-de-tenants).
  - **Simulação de Visão de Perfil** — permite ao superadmin "entrar" na sessão de um usuário real já cadastrado (aluno, gestor de academia/studio, personal ou nutricionista) para testar e validar exatamente o que aquele perfil enxerga, sem saber a senha de ninguém. Usa a Edge Function `impersonar-perfil` e nunca expõe a senha do usuário simulado. O banner amarelo "Modo simulação" aparece em qualquer tela enquanto a simulação está ativa; clicar em "Voltar para Admin" restaura a sessão original. Como a mesma pessoa pode ter mais de um vínculo ativo (ex.: aluno numa organização e gestor de outra), o seletor identifica cada opção por `user_id` **+** `organization_id`, não só pelo usuário — evita simular a organização errada quando o mesmo nome aparece mais de uma vez na lista.
- **`/superadmin/profissionais`** (`SuperAdminProfissionais.tsx`) — gestão dos Personal Trainers e Nutricionistas autônomos convidados diretamente pela ARKE. Ver [seção 2.3](#23-profissionais-autônomos).

O acesso é controlado por `ProtectedRoute` (rotas exigem `requiredRoles=["superadmin"]`) e, no banco, pelas próprias funções RPC do painel, que checam `has_role(auth.uid(), 'superadmin')` internamente antes de retornar qualquer dado — mesmo que alguém consiga chamar a função diretamente via API, ela recusa (`raise exception`) se o chamador não for superadmin.

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
3. Resolve o gestor pelo e-mail informado:
   - **E-mail inédito**: convida via `auth.admin.inviteUserByEmail`, redirecionando para `arkefit.com.br` — **nunca gera nem expõe senha temporária**; o próprio Supabase Auth envia o link de definição de senha.
   - **E-mail que já tem conta** (ex.: a mesma pessoa já é gestora de outra organização): em vez de tentar convidar de novo (o que sempre falharia com "e-mail já cadastrado"), a função localiza o `user_id` existente e o vincula à organização nova como gestor, avisando por e-mail sobre o novo vínculo.
4. Cria o `profile` (só para conta nova — uma conta já existente mantém o perfil que já tinha) e o vínculo em `organization_members` com `role = "gestor"`.
5. Se qualquer etapa **estrutural** falhar (perfil, vínculo, ou não conseguir localizar uma conta existente), a função faz **rollback explícito** (deleta o usuário convidado, quando foi criado agora, e/ou a organização) — não fica organização "pela metade" no banco. Já uma falha isolada no **envio do e-mail** (convite ou aviso) não desfaz nada — a organização e o vínculo do gestor são criados normalmente, e a tela só avisa "Organização criada com sucesso! (Aviso: não foi possível enviar o e-mail...)" para o superadmin repassar o acesso manualmente se precisar.

Se o slug já existir, a função retorna erro explicando o conflito, sem tentar adivinhar um slug alternativo.

#### Nota: plano B2B vs. nível de atacado

São dois conceitos diferentes no schema, não confundir:

- **`plano_b2b`** (`starter | growth | enterprise | custom | autonomo`): quanto a academia paga à ARKE **pela plataforma** (assinatura mensal fixa, R$ 390/790/1.290 ou sob consulta — ver `CLAUDE.md` para a tabela completa).
- **`nivel_atacado`** (`essencial | integrado | elite`): o pacote que **cada aluno** contrata dentro da academia (Treino / Treino+Nutrição / Acompanhamento 360°), com custo de atacado pago pela academia à ARKE e markup livre definido pela própria academia em `/admin/organizacao`.

### 2.2 Busca, filtros, abas de carteira e edição de um tenant existente

Acima da tabela, três abas separam a carteira de tenants para gestão em escala, cada uma com o contador de quantos tenants tem naquele grupo:

- **Ativos / Trial**: status `ativo` e `trial` — o dia a dia de quem está pagando ou em avaliação.
- **Inativos / Cancelados**: status `suspenso`, `inadimplente` e `cancelado` — a "faxina" de contas mortas ou em risco.
- **Todos**: visão geral completa, sem filtro de status.

A tabela em si tem busca por nome/slug e filtros por Tipo (Academia/Studio/Profissional Autônomo) e Status — combináveis com a aba selecionada. Cada linha mostra Alunos, MRR, assinaturas atrasadas, Plano master, Status e **Última Atividade** (a data mais recente entre um check-in ou um treino criado na organização — é o indicador de health score para identificar contas inativas antes do churn).

O menu de ações (ícone ⋮) por tenant oferece:

- **Editar Informações do Tenant**: altera nome, tipo de negócio, plano master, CNPJ/CPF, telefone e data limite do trial (update direto via RLS `"superadmin gerencia organizations"` — sem Edge Function). CNPJ/CPF e telefone são obrigatórios para emitir cobrança B2B (ver [seção 3](#3-asaas--split-de-pagamento)) ou criar o cliente no Asaas.
- **Resetar Token do Gateway Local**: gera um novo `device_token` para **todas** as catracas da organização (via RPC `superadmin_resetar_tokens_gateway`, restrita a `service_role`). Ação irreversível e exige confirmação — os leitores físicos da academia param de autenticar até alguém reconfigurar o `config.json` do Gateway Local no local com o novo token (ver [Manual do Gateway Local](MANUAL_GATEWAY_LOCAL.md)).
- **Alterar E-mail do Gestor Master**: troca o e-mail de login do gestor ativo mais antigo da organização, via `auth.admin.updateUserById` (Admin API — exige a Edge Function `superadmin-suporte-tenant`, pois e-mail vive em `auth.users`, não em `profiles`).
- **Suspender/Ativar acesso do tenant**: bloqueia (ou libera) o login de gestor, equipe e alunos da organização inteira. Exige confirmação explícita.
- **Excluir Organização** (destaque vermelho): apaga **permanentemente** a organização e todo o histórico vinculado — alunos, equipe, treinos, dietas, check-ins, agendamentos e cobranças. A confirmação exige digitar o nome exato da organização (não é só um clique). Tecnicamente, a Edge Function `superadmin-suporte-tenant` (ação `excluir_organizacao`) apaga a linha em `organizations`; toda tabela filha do schema referencia `organization_id` com `on delete cascade` desde a fundação do multitenant, então a limpeza é automática no banco. As contas em `auth.users` do gestor **não** são apagadas, já que a mesma pessoa pode ser gestora de mais de uma organização. Ação irreversível, sem desfazer.

Todas essas ações exigem papel `superadmin` — a Edge Function e o RPC checam isso antes de qualquer efeito colateral. Qualquer erro de negócio (ex.: a proteção que impede remover o último gestor ativo de uma organização) chega com o texto exato do motivo no toast da tela — a função sempre responde HTTP 200 com `{ error }` no corpo em vez de um status não-2xx, para o `supabase-js` não substituir a mensagem real por um erro genérico.

### 2.3 Profissionais Autônomos

Tela separada em **`/superadmin/profissionais`**. Lista os Personal Trainers e Nutricionistas que compram a plataforma direto da ARKE (fora do modelo academia/studio) via RPC `get_superadmin_profissionais_autonomos()`.

- **Botão "Novo Profissional"**: convida um profissional autônomo por e-mail via Edge Function `convidar-profissional-autonomo`. Diferente do convite de tenant comum, esse fluxo cria uma **organização própria de 1** (`tipo = 'profissional_autonomo'`) para o convidado, que vira `gestor` dela — carteira de alunos e prescrições (treino/dieta) exclusivamente dele, isolado por tenant como qualquer outra organização.
- Isso é diferente do convite de staff feito **por um gestor de academia/studio** (tela `/admin/equipe`, Edge Function `convidar-membro`): nesse caso o profissional entra como membro (`professor`/`nutricionista`) **na organização de quem convidou**, sem criar organização nova — ele fica atribuído a esse gestor, dentro do tenant da academia/studio.
- Cada linha mostra Especialidade, E-mail, Alunos, status do convite (ativou a conta / pendente) e Status. Se uma organização `profissional_autonomo` não tiver nenhum gestor vinculado (dado órfão — pode acontecer se uma etapa do convite falhar parcialmente), ela aparece com o aviso **"Sem gestor vinculado"** em vez de simplesmente sumir da lista.

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

### 3.2 Cobrança B2B avulsa (fora do split automático)

Na aba "Faturamento / Cobranças B2B" do modal de edição do tenant, o superadmin pode emitir uma cobrança avulsa contra a própria academia/studio (mensalidade da plataforma, taxa de implantação etc.) — direção oposta do split de aluno: aqui a ARKE recebe o valor inteiro, sem split, na conta dona da `ASAAS_API_KEY`. A Edge Function `asaas-emitir-cobranca-b2b`:

1. Exige CNPJ/CPF **e** telefone cadastrados na aba Informações do tenant (ver [seção 2.2](#22-busca-filtros-abas-de-carteira-e-edição-de-um-tenant-existente)) — o Asaas recusa criar o cliente sem esses dados.
2. Reaproveita o `asaas_customer_id_b2b` já salvo na organização, se existir. Senão, **busca** no Asaas por CPF/CNPJ antes de criar — evita duplicar o cadastro fiscal de um cliente que já exista lá por outro caminho — e só cria um novo se realmente não encontrar.
3. Qualquer recusa do Asaas (documento inválido, e-mail inválido etc.) chega com a mensagem específica do gateway no toast da tela, prefixada com "Asaas: ", em vez de um erro genérico.

### 3.3 Pendência conhecida

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

## 6. E-mails Transacionais de Autenticação

Todo e-mail de autenticação (convite de gestor, confirmação de cadastro, recuperação de senha, magic link, troca de e-mail, reautenticação) sai com o layout da marca ArkeFit — logo e cores — em vez do template de texto puro padrão do Supabase.

### 6.1 Como funciona

- O Supabase Auth está configurado com um **Auth Hook "Send Email"** (Dashboard → Authentication → Hooks) que aponta para a Edge Function `send-email`. Em vez do mailer built-in, toda vez que o Auth precisa mandar um e-mail, ele chama essa função.
- A função identifica o tipo de e-mail (`email_action_type`: `invite`, `signup`, `recovery`, `magiclink`, `email_change` ou `reauthentication`), renderiza o template [React Email](https://react.email/) correspondente (`supabase/functions/send-email/_templates/`) e envia via **Resend**, usando o domínio verificado `arkefit.com.br`.
- A chamada do Auth para a função é autenticada por **assinatura de webhook** (padrão Svix), não por JWT de usuário — por isso a função tem `verify_jwt = false`. Isso é esperado e não é uma falha de segurança: quem valida a origem da chamada é a verificação de assinatura dentro da própria função (`SEND_EMAIL_HOOK_SECRET`), não o JWT.

### 6.2 Secrets necessários (Edge Functions → Secrets)

| Secret | Origem |
|---|---|
| `RESEND_API_KEY` | Gerada no [dashboard do Resend](https://resend.com/api-keys), com permissão de envio restrita ao domínio `arkefit.com.br`. |
| `SEND_EMAIL_HOOK_SECRET` | Gerada automaticamente pelo Supabase ao clicar em "Generate Secret" na configuração do hook (formato `v1,whsec_...`). |

Se qualquer um dos dois estiver ausente ou incorreto, o e-mail falha com HTTP 500 no hook — o Supabase mostra "Unexpected status code returned from hook: 500" na tela de quem está tentando se cadastrar/recuperar senha. Para diagnosticar, consulte os logs da função (`function_logs`, filtro `send-email`) — o erro real (ex.: `Missing API key`) aparece ali.

### 6.3 Adicionando um novo tipo de e-mail

Se o Supabase Auth introduzir um novo `email_action_type` sem template correspondente, a função não falha a autenticação — só loga o tipo desconhecido (`console.error`) e não envia e-mail nenhum para aquele evento específico. Para cobrir um tipo novo, crie o template em `_templates/` seguindo o padrão dos existentes (usa o componente compartilhado `EmailLayout` de `_templates/_components/brand.tsx`) e adicione o `case` correspondente no `switch` de `send-email/index.ts`.
