# Manual do Gestor da Academia / B.A.S.E.® — ArkeFit

> Painel: `/admin` · Papéis: `gestor` (ou `admin_arke` em homologação) da organização
> Público-alvo: gestores de academias, studios e profissionais autônomos que administram a própria unidade.

## Sumário

1. [Visão geral do painel](#1-visão-geral-do-painel)
2. [Financeiro](#2-financeiro)
3. [Matrículas](#3-matrículas)
4. [M.A.P.A.® & SLA](#4-mapa--sla)
5. [Catracas](#5-catracas)

---

## 1. Visão geral do painel

Depois do login, todo staff (gestor, personal, nutricionista, recepção, admin_arke) cai automaticamente em **`/admin/dashboard`** — a Home personalizada por papel. Ela mostra cards e atalhos diferentes conforme o seu papel e o tipo de negócio da organização (Academia, Studio, ou Profissional Autônomo):

- **Gestor de Academia**: Alunos Presentes Hoje, Alertas de Retenção, Status da Catraca — atalhos para Novo Aluno, Liberar Catraca, Convidar Equipe.
- **Gestor de Studio**: Próximas Aulas do Dia, Taxa de Ocupação das Turmas, Fila de Espera — atalhos para Nova Turma/Aula, Novo Aluno, Marcar Presença.

Se a organização ainda não terminou a configuração inicial (`organizations.onboarding_completed = false`), um banner discreto aparece no topo da Home levando para `/admin/onboarding`.

A sidebar (retrátil, toggle `«` no topo) é organizada em 3 blocos:

| Bloco | Itens |
|---|---|
| **Operação** | Home (Início), Atendimento (Fila), Alunos & Prescrições, Agenda (só para Studio) |
| **Inteligência** | Gestão 360°, Equipe (restritos a gestor/admin_arke) |
| **Configurações** | Organização, Catracas |

## 2. Financeiro

### 2.1 Checkout Transparente e formas de pagamento

Quando um aluno assina um plano (pela auto-matrícula pública ou cadastrado pelo staff), a Edge Function `asaas-create-subscription` cria a cobrança recorrente no Asaas com `billingType: "UNDEFINED"` — **checkout transparente**: o próprio aluno escolhe PIX, Boleto ou Cartão no momento de pagar. Você não precisa (nem consegue) pré-definir a forma de pagamento pela academia.

### 2.2 Régua de adimplência

Não existe uma campanha de lembretes automáticos por e-mail/SMS — a "régua" do ArkeFit é orientada por **estado da assinatura** e reforçada pela própria catraca:

1. O webhook `asaas-webhook` atualiza `aluno_assinaturas.status` conforme o Asaas confirma/atrasa a cobrança (`ativa` → `atrasada` → possivelmente `cancelada`).
2. Quando `atrasada`, `fatura_pendente_url` é preenchido com o link da fatura no Asaas — o app do aluno mostra esse link para quitação direta.
3. A catraca física nega automaticamente o acesso de alunos com assinatura `atrasada` (Edge Function `catraca-validar-acesso`, motivo `negado_inadimplente`) — o próprio uso do espaço vira o lembrete mais eficaz.
4. O card "Alertas de Retenção" na Home e a tela `/admin/retencao` ajudam a equipe a agir proativamente antes da catraca negar o acesso (ex.: ligar para o aluno).

### 2.3 Recibos e comprovantes

Em `/admin/organizacao`, a tabela "Assinaturas da Academia" tem um botão de impressora por linha — abre o `ReciboComprovanteDialog`, que monta um comprovante com nome do aluno, plano, valor, forma de pagamento e status, e usa `window.print()` com regras `@media print` dedicadas (definidas em `src/index.css`) para imprimir só o comprovante, sem o resto da interface do navegador.

### 2.4 DRE e LTV

Em **`/admin/gestao-360`** (Gestão 360°): dashboard executivo com **DRE Simplificado do mês corrente** e **LTV estimado** (ARPU ÷ % de churn do período), além de exportação para PDF e Excel — use para prestação de contas e planejamento.

## 3. Matrículas

### 3.1 Importação em lote por CSV/XLSX

Em `/admin/alunos/importar`: o importador roda **inteiramente no navegador** (o arquivo nunca é enviado a um servidor inteiro — só as linhas já processadas seguem para o Supabase), então a UI não trava mesmo com planilhas grandes, dentro dos limites de sanidade:

- Tamanho máximo: **5 MB**.
- Linhas máximas: **2.000**.

O fluxo é: (1) selecionar o arquivo, (2) mapear cada coluna da planilha para um campo de destino (Nome completo, E-mail, Telefone, CPF, Plano — `essencial`/`integrado`/`elite`, ou "Ignorar coluna"), (3) processar linha a linha com feedback visual de sucesso/erro por linha, sem travar a aba do navegador.

### 3.2 Ativação de alunos e links de convite

Depois de importado (ou cadastrado manualmente), cada aluno precisa ativar o próprio acesso. Duas formas:

- **E-mail**: convite padrão do Supabase Auth (sem senha temporária exposta).
- **WhatsApp**: botão "Enviar Ativação via WhatsApp" chama a Edge Function `gerar-link-ativacao`, que gera um link de definição de senha tokenizado (`auth.admin.generateLink`, tipo `recovery`) e devolve o link pronto — **não envia e-mail**, apenas monta a mensagem para você colar/enviar direto no WhatsApp do aluno.

### 3.3 Auto-matrícula pública

Cada organização tem um link público de matrícula: `arkefit.com.br/#/p/<slug>` (o slug é definido no onboarding ou em `/admin/organizacao`, card "Perfil do Estabelecimento"). Alunos podem se cadastrar e escolher o plano sozinhos, sem depender do staff.

## 4. M.A.P.A.® & SLA

### 4.1 "Minha Fila" — `/admin` (Atendimento)

A tela de Atendimento (primeiro item da sidebar sob "Operação", rota `/admin`) é a central de pendências do dia: cada evento da jornada do aluno vira automaticamente uma tarefa, com responsável, prazo (SLA) e prioridade. Tipos de tarefa:

| Tipo | Gatilho | Prioridade/Prazo (padrão) |
|---|---|---|
| `ativacao` | Aluno sem 1º acesso após 48h | Configurado em `sla_config` |
| `anamnese` | Nova anamnese de acolhimento (M.A.P.A.®) concluída, aguardando análise do profissional | Configurado em `sla_config` |
| `dor` | Relato de dor/desconforto no treino | Alta prioridade — revisão antes do próximo treino |
| `barreira` | 2 treinos previstos sem registro (falta de rotina) | Configurado em `sla_config` (tipo `barreira`) |
| `ajuste` | Pedido de ajuste do aluno ("Preciso de ajuste") | Configurado em `sla_config` |

Toda tarefa segue o ciclo completo: **Motivo → Responsável → Prazo → Ação → Desfecho → Próxima Checagem** — uma pendência só é encerrada quando alguém registra um desfecho (texto livre com o parecer técnico), nunca com um simples "concluir" sem explicação.

Duas abas: **"Minha Fila"** (tarefas atribuídas a você ou sem responsável) e **"Fila da Organização"** (todas as tarefas abertas/em andamento/aguardando da unidade). Tarefas vencidas (SLA estourado) ganham um badge "Vencido" visualmente destacado.

### 4.2 Alertas e gatilhos automáticos

O motor de automações previne falha humana: eventos repetidos não geram tarefas duplicadas (proteção anti-duplicação/idempotência), e pausas/cancelamentos de aluno encerram automações ativas imediatamente. Resposta de atendimento atrasada além do SLA escala automaticamente para o gestor da unidade (badge "Escalada" na tarefa).

## 5. Catracas

### 5.1 Cadastro em `/admin/catracas`

Cada dispositivo físico de catraca da unidade precisa ser cadastrado uma vez em `/admin/catracas`: nome do dispositivo, localização (ex.: "Entrada principal") e status (ativo/inativo). Ao salvar, o sistema gera um `device_token` (UUID único por dispositivo).

### 5.2 Obtendo o `device_token` para o Gateway Local

Ao lado de cada catraca cadastrada há um botão **"Copiar"** que copia o `device_token` para a área de transferência. Esse valor é exatamente o que vai no campo `token_api_local` do `config.json` do **ARKE Gateway Local**, instalado no computador da recepção conectado fisicamente à catraca — ver [Manual do Gateway Local](MANUAL_GATEWAY_LOCAL.md) para o passo a passo completo de instalação e configuração.

> Se o token vazar ou precisar ser trocado por qualquer motivo, peça ao SuperAdmin para usar a ação "Resetar Token do Gateway Local" em `/superadmin` — isso gera um novo token para todas as catracas da organização, exigindo reconfiguração do Gateway Local no local físico.

### 5.3 Status em tempo real

A tela `/admin/catracas` usa Supabase Realtime para refletir mudanças de status assim que ocorrem (ex.: se outro gestor ativar/inativar um dispositivo em outra aba), sem precisar recarregar a página.
