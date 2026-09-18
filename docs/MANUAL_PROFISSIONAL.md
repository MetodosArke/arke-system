# Manual do Profissional / M.A.P.A.® — ArkeFit

> Painel: `/admin` · Papéis: `professor` (Personal Trainer) e `nutricionista`
> Público-alvo: personal trainers e nutricionistas — vinculados a uma academia/studio, ou profissionais autônomos com carteira própria.

## Sumário

1. [Visão geral do painel](#1-visão-geral-do-painel)
2. [Prescrição de Treinos](#2-prescrição-de-treinos)
3. [Avaliação Física](#3-avaliação-física)
4. [Nutrição](#4-nutrição)

---

## 1. Visão geral do painel

A Home (`/admin/dashboard`) mostra a visão certa automaticamente, conforme seu papel na organização:

- **Personal Trainer**: cards de Minha Fila de Prescrição, Treinos a Vencer (próximos 7 dias) e Avaliações do Dia — atalhos para Prescrever Treino e Nova Avaliação.
- **Nutricionista**: cards de Dietas Pendentes, Consultas do Dia e Alunos sem Plano Alimentar — atalhos para Criar Dieta e Agendar Retorno.

Se você é profissional autônomo (organização do tipo `profissional_autonomo`), sua carteira é só sua — o menu lateral é simplificado (Home, Atendimento, Meus Alunos), sem Catracas/Organização/Equipe, e o app já direciona automaticamente para a visão de Personal ou Nutricionista conforme sua especialidade cadastrada.

A tela **"Minha Fila"** (`/admin`, primeiro item da sidebar) reúne suas pendências pessoais: anamneses novas para analisar, relatos de dor/desconforto e pedidos de ajuste — sempre com prazo (SLA) e exigindo um desfecho registrado para encerrar cada uma. Ver detalhes no [Manual do Gestor, seção M.A.P.A.® & SLA](MANUAL_GESTOR.md#4-mapa--sla).

## 2. Prescrição de Treinos

Em **`/admin/treinos`**: monte a ficha do aluno escolhendo exercícios da **Biblioteca ARKE** — **105 exercícios** cadastrados, organizados por grupo muscular, com valores padrão de séries/repetições/descanso já sugeridos (que você pode ajustar por aluno).

### 2.1 Templates prontos (fichas modelo)

Para agilizar, cada organização já nasce com **5 templates de treino** clonáveis, disponíveis na própria tela de Treinos:

1. **Adaptação A** — 6 exercícios (peito, costas, quadríceps, isquiotibiais, ombros, core)
2. **Adaptação B** — 7 exercícios (variação da Adaptação A, com braços)
3. **Hipertrofia A** — foco em peito/costas/ombros/braços
4. **Hipertrofia B** — foco em pernas/posterior/core
5. **Metabólico (Emagrecimento)** — foco em circuito de alta intensidade

Você pode clonar um template e ajustá-lo por aluno, ou montar do zero direto da biblioteca de 105 exercícios.

### 2.2 Versionamento imutável

Toda prescrição publicada gera um **snapshot travado** (`versao_id`) — alterar um modelo depois (na biblioteca global ou nos templates) **não muda** os treinos já publicados e em uso pelos alunos. Isso garante que o aluno sempre veja exatamente o que foi prescrito, mesmo que a biblioteca evolua depois.

## 3. Avaliação Física

### 3.1 Anamnese ampliada

A anamnese de acolhimento (M.A.P.A.®), preenchida pelo aluno no onboarding, cobre: objetivo principal, expectativas, rotina diária, tempo disponível, experiências anteriores com exercício, dores/lesões, medicamentos, estilo de treino preferido, rotina e preferências alimentares — mais sono, estresse e frequência de treino pretendida, e o consentimento LGPD para dados de saúde. Você consulta essa anamnese direto em "Minha Fila" (botão "Ver Anamnese" na tarefa) antes de prescrever.

### 3.2 Registro de avaliação física

Pelo atalho "Nova Avaliação" na Home (ou diretamente na ficha do aluno), você registra: peso, altura, IMC, percentual de gordura, dobras cutâneas (abdominal, axilar média, coxa, peitoral, subescapular, suprailíaca, tríceps), perimetria (abdômen, antebraço, braço, cintura, coxa, panturrilha, quadril), dores relatadas, histórico clínico e observações. Os campos numéricos têm validação de faixa (peso/altura positivos, % de gordura entre 0–100, dobras/perimetria não-negativas) tanto no formulário quanto no banco — evita registrar valores absurdos por erro de digitação.

### 3.3 Mapeamento de dores e gatilho de SLA

O relato de dor que **dispara automaticamente uma tarefa crítica de SLA** vem do **check-in R.O.T.A.®** do próprio aluno (não da ficha de avaliação física, que é documentação técnica do profissional): quando o aluno marca, no check-in, a opção "Com dificuldade" → motivo "Desconforto / dor", o sistema cria imediatamente uma tarefa tipo `dor`, prioridade padrão **crítica**, com o prazo configurado em `sla_config` (padrão 12h) — "Alerta de revisão profissional antes do próximo treino". Ela aparece na sua "Minha Fila" com destaque visual (badge vermelho) até você registrar o desfecho.

O campo "Dores relatadas" da avaliação física complementa esse registro com o detalhamento clínico, mas não substitui nem duplica o gatilho automático do check-in.

## 4. Nutrição

### 4.1 Tabela nutricional (Biblioteca ARKE)

Em **`/admin/dietas`**: monte o plano alimentar do aluno consultando a **Tabela Nutricional B.A.S.E.®**, com **83 alimentos** cadastrados (base inspirada na Tabela TACO/IBGE — valores aproximados), com informações nutricionais por porção para orientar a montagem de refeições equilibradas.

### 4.2 Versionamento imutável

Assim como os treinos, cada dieta publicada gera um **snapshot travado** (`versao_id`) — alterações futuras na biblioteca de alimentos ou em modelos de dieta não afetam planos já publicados e em uso pelos alunos.

### 4.3 Fila e alertas

O card "Dietas Pendentes" na sua Home conta as tarefas abertas/em andamento atribuídas a você (ou sem responsável) dos tipos `anamnese` e `ajuste` — a mesma fila de pendências que aparece em "Minha Fila", filtrada para o que precisa da sua atenção como nutricionista. O card "Alunos sem Plano Alimentar" identifica quem já contratou nutrição no plano (`provedor_nutricao ≠ 'nenhum'`) mas ainda não tem nenhuma dieta `ativa` publicada — use para priorizar quem está sem acompanhamento.
