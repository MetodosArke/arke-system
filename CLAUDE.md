# Sistema Arke — Briefing para Claude Code

> **Nome comercial: ArkeFit** — domínio `arkefit.com.br`

> Rascunho v0.1 — gerado a partir de: One Pager da Jornada Arke, código `arke-app` (piloto do método), código `SistemaArke-atualizado` (SaaS multi-tenant), e o documento "ARKE — Lógica do Sistema e Jornada de Atendimento" v1.0.
> Este documento é o ponto de partida. Ainda falta validar decisões em aberto (seção 8) antes de considerá-lo definitivo.

## 1. O que é o Sistema Arke

SaaS multi-tenant para academias, studios, personais e nutricionistas entregarem treino, nutrição e acompanhamento contínuo com operação organizada, rápida e escalável — com a metodologia proprietária Arke (M.A.P.A. → B.A.S.E. → R.O.T.A. → A.P.E.X. → L.E.G.A.D.O.) embarcada como diferencial.

**Pergunta que o sistema precisa responder todo dia:** quem precisa de atenção, por qual motivo, quem deve atender e qual é a próxima ação?

**Princípio central:** automatizar a organização e a preparação do atendimento, mantendo a decisão profissional onde ela é necessária. Personalização = usar dados reais do membro para uma ação pertinente, nunca fingir uma análise que não foi feita.

A Arke começa como uma **camada de acompanhamento**, sem substituir o financeiro, a catraca ou a gestão comercial da academia — isso pode ser integrado depois.

## 2. Papéis e permissões (RBAC)

| Papel | Acessos principais | Limites |
|---|---|---|
| Administrador Arke | Configura academias, módulos, jornadas, equipes | Acesso a dados individuais só quando necessário/autorizado |
| Gestor da academia | Equipe, operação, indicadores da própria academia | Sem acesso a dados nutricionais/relatos sensíveis |
| Profissional de treino | Membros atribuídos, avaliações, treinos | Não publica plano alimentar |
| Nutricionista | Membros atribuídos, atendimento nutricional | Não publica prescrição de treino |
| Atendimento | Pendências, agendamento, comunicação operacional | Não altera prescrições |
| Membro | Seus planos, registros, evolução, solicitações | Não acessa dados de outros membros |

**Regra não negociável:** isolamento entre academias e verificação de permissões **no servidor** (RLS/policies), nunca só escondendo botão na interface. Isso pertence à fundação do sistema, não pode ficar para depois.

## 3. Decisões de arquitetura já tomadas

- **Infraestrutura**: GitHub (código, conectado via Claude Code), Vercel (deploy/hosting), Supabase (banco + auth + storage), Resend (e-mails transacionais).
- **Banco de dados único**: consolidar em **Supabase Postgres**. O núcleo SaaS do `SistemaArke-atualizado` hoje vive em TiDB via Drizzle — isso será migrado para Supabase.
- **Sem dependências da plataforma Manus**: remover `__manus__`, `vite-plugin-manus-runtime`, OAuth via manus.im, `forge.manus.ai`. Autenticação passa a ser 100% Supabase Auth — o que também deve aposentar a necessidade do `JWT_SECRET` próprio do backend custom.
- **Sem localStorage, mocks ou dados de demonstração** em nenhuma tela de produção. Toda leitura/escrita é em tempo real no Supabase. Banco vazio = mostrar zero/empty state, nunca dado fake.
- **`arke-app` (conteúdo do método)**: vira um **módulo opt-in** dentro do Sistema Arke, que cada academia pode oferecer aos próprios alunos (não é obrigatório para toda organização que assina o SaaS).
- **Segurança**: nenhuma credencial em texto puro no repositório. Tudo via variáveis de ambiente na Vercel/Supabase.
  - Fase atual de desenvolvimento: mantidas as senhas de super admin e a Resend API key já existentes (aceitas como dívida técnica, a trocar antes do lançamento oficial).
  - Service Role Key do Supabase: reaproveitada, mas só pode existir como variável de ambiente do lado do servidor — nunca em código de cliente nem versionada.
  - Chaves de produção do Asaas e da OpenAI já fornecidas — configurar como variáveis de ambiente na Vercel assim que o repositório estiver pronto para receber deploy.

## 4. Arquitetura funcional (módulos)

| Módulo | Função | Entrega principal |
|---|---|---|
| Configuração da academia | Unidades, equipamentos, profissionais, serviços | Operação pronta para receber membros |
| Cadastro e ativação | Convite, acesso, informações iniciais | Membro identificado e vinculado |
| Avaliação e acolhimento | Objetivos, rotina, histórico, conversa inicial | Contexto para planejamento |
| Prescrição | Modelos, edição, revisão, publicação | Treino e plano alimentar versionados |
| Jornada | Etapas, datas, condições de avanço | Próximas ações organizadas |
| Check-ins | Coleta rápida de adaptação/dificuldades | Sinais para acompanhamento |
| Central de atendimento | Fila, responsáveis, prazos, histórico | Solicitações resolvidas |
| Regras e alertas | Transforma eventos em tarefas | Atendimento por prioridade |
| Gestão | Indicadores de entrega e capacidade | Controle da operação |
| **CRM de vendas** *(diferencial)* | Funil de leads, follow-up e fechamento de novos membros | Conversão de lead em membro ativo |

**Nota sobre catracas**: a Arke **não fornece** hardware de controle de acesso — cada academia já tem sua própria infraestrutura (catraca, biometria, etc.). O cadastro da unidade (módulo "Configuração da academia") precisa registrar qual marca/modelo já está instalado, e o sistema aciona o adaptador correspondente para ler os eventos dessa estrutura existente via webhook/middleware local.

## 5. Jornada do membro (referência, não implementação fechada)

1. **Ativação** (dia 0) — acesso e boas-vindas
2. **Descoberta — M.A.P.A.** (dias 0–2) — objetivo, rotina, avaliação
3. **Consulta de Acolhimento** (~dia 2)
4. **Planejamento** — publicação dos planos contratados
5. **Adaptação** (1ª semana) — check-in e ajustes
6. **Constância** — acompanhamento contínuo
7. **Revisão** (marco configurável, ex. 30–45 dias)
8. **Novo ciclo** (marco configurável, ex. 90 dias)

Regras de exceção (não inventar dado, permitir reagendamento, encaminhar dor/situação sensível ao profissional em vez de automatizar, respeitar pausa/cancelamento) valem para toda a automação do sistema.

## 6. Motor de regras (lógica central)

Toda regra automática precisa declarar: evento de origem, condições, ação, prioridade, responsável, prazo, limite de repetição e condição de encerramento. Nunca duplicar tarefa aberta, nunca afirmar resultado não verificado, nunca tratar ausência de registro como prova de ausência de treino.

**Prioridade sem falsa precisão** — usar categorias explicáveis, não uma nota numérica de "risco":
- Rotina
- Atenção
- Prioritário
- Encaminhamento profissional

Manter separados: **adesão** (participação registrada) × **prioridade** (necessidade operacional) × **evolução** (mudança de medidas/objetivos). Nunca juntar tudo numa "nota de saúde".

## 7. Regras gerais de execução para o Claude Code

1. Trabalhar **uma etapa por vez**, aguardando validação antes de avançar (modo Plan no Claude Code, não Auto).
2. Nunca usar localStorage, mocks ou dados de demonstração.
3. Toda tela lê/escreve em tempo real no Supabase; sem dados = estado vazio (zero), nunca dado fake.
4. Preservar a estrutura visual e componentes já construídos — mudanças de escopo de dados não devem exigir redesenho de tela sem necessidade.
5. Código limpo, seguro, pronto para deploy automático via Vercel.
6. Isolamento entre academias e verificação de permissão no servidor desde a primeira etapa (não é item de "fase 2").

## 8. Pendências e decisões em aberto

**Resolvidas nesta rodada:**
- ✅ GitHub conectado via Claude Code
- ✅ Consolidação em Supabase confirmada
- ✅ `arke-app` confirmado como módulo opt-in oferecido pelas academias aos alunos
- ✅ Chave de produção do Asaas fornecida
- ✅ Chave da OpenAI fornecida (motor de IA será OpenAI, não Gemini)
- ✅ Decisão consciente de manter por enquanto: senhas de super admin, Resend API key, Service Role Key do Supabase

| # | Pendência | Bloqueia o quê |
|---|---|---|
| 8.1 | Registrar a URL de webhook do Asaas dentro do painel Asaas (Integrações → Webhooks) | Só depois do primeiro deploy na Vercel — não bloqueia o início |
| 8.2 | Solicitar ao gerente de conta do Asaas a habilitação de tokenização de cartão em produção | Etapa de checkout transparente |
| 8.3 | Credenciais de parceiro Wellhub (Client ID/Secret/Partner ID) e TotalPass (App Key/Secret/Gym ID) — em contato com as empresas | Etapa de benefícios |
| 8.4 | Cobrir progressivamente as marcas de catraca já usadas pelas academias clientes (Control iD, Topdata, Henry, Dimep) via adaptador por marca — sem integrador único no mercado | Não bloqueia o início; primeira marca real só é definida quando a primeira academia piloto entrar |
| 8.5 | Gerar novas chaves de produção (Asaas e OpenAI) para substituir as que foram compartilhadas em texto no chat, e trocar as senhas de super admin/Resend antes do lançamento oficial | Não bloqueia o início — dívida técnica para antes de ir ao ar |

## 9. Roadmap (adaptado do roteiro original, para execução no Claude Code)

> Ordem de desenvolvimento adaptada da seção 14 do documento de lógica + do roteiro de 9 etapas, com os itens sem pré-requisito resolvido movidos para o fim.

1. **Fundação**: consolidação do banco em Supabase, schema de academias/usuários/permissões/vínculos, RLS testado (isolamento entre academias comprovado)
2. **Acervo Global**: tabelas de exercícios, grupos musculares, modelos de ficha e planos alimentares + CRUD no Painel Admin + regra de acesso por plano contratado
3. **Jornada inicial**: convite, cadastro, avaliação, acolhimento — um membro percorre o fluxo completo
4. **Entrega profissional**: modelos, revisão e publicação de treino/nutrição com autor e versão rastreáveis
5. **Onboarding multi-tenant**: criação de organização com RLS, link individualizado (`arkefit.com.br/slug-do-cliente`)
6. **Acompanhamento**: check-in, central de atendimento (tela "Minha fila"), histórico, resposta
7. **Automação**: gatilhos, lembretes, escalonamento — sem duplicação
8. **Gestão**: prazos, capacidade, indicadores
9. **Módulo Academia**: fichas, matrícula, frequência, geração de PDF
10. **Módulo Studio**: turmas, horários fixos, limite de vagas, agenda
11. **Módulos Personal/Nutricionista**: vínculo por convite, envio de treino/dieta ao app do aluno
12. **CRM de vendas**: funil de leads, follow-up automatizado e fechamento de novos membros
13. **Pagamentos Asaas em produção**: cobrança real + webhook registrado (ver 8.1) + tokenização (ver 8.2)
14. *(bloqueado — 8.3)* Benefícios Wellhub/TotalPass
15. *(bloqueado — 8.4)* Integração de catracas (adaptador por marca)
16. Agente de IA curador do acervo (OpenAI já disponível)

## 10. Testes mínimos para aceitar o MVP

O sistema está pronto para piloto quando comprovar que: uma academia não acessa dados de outra; um membro recebe só seus próprios planos; uma prescrição mantém autor e versão; repetir um evento não duplica tarefa; um pedido de ajuda chega à pessoa certa; uma tarefa vencida é escalada; uma pausa interrompe lembretes previstos; uma falha de envio aparece para a equipe; uma tarefa resolvida registra o resultado; um backup pode ser restaurado.

**Diretriz final:** o MVP não está validado porque o membro recebeu um treino. Está validado quando ele encontra uma dificuldade, o sistema identifica ou recebe essa necessidade, a pessoa certa atende, e a resolução fica registrada — com custo operacional sustentável.
