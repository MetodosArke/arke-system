# ARKE — Diretrizes de Desenvolvimento e Contexto do Projeto

## Visão Geral do Sistema
O ARKE é uma plataforma SaaS B2B/B2C para academias, studios e personal trainers que combina software de acompanhamento com uma metodologia ativa de atendimento, treino e nutrição (M.A.P.A.®, R.O.T.A.®, APEX® e LEGADO®) para reduzir o churn evitável e incrementar a receita das academias parceiras[span_51](start_span)[span_51](end_span)[span_52](start_span)[span_52](end_span).

## Arquitetura e Stack
- **Frontend:** React + TypeScript, Vite, TailwindCSS, Shadcn/UI, Lucide React[span_53](start_span)[span_53](end_span).
- **Backend & Banco de Dados:** Supabase (Auth, PostgreSQL, Row Level Security - RLS, Storage, Edge Functions)[span_54](start_span)[span_54](end_span).
- **Hospedagem:** Vercel[span_55](start_span)[span_55](end_span).

## Princípios de Engenharia e Regras Estritas
1. **Multitenancy em Primeiro Lugar:** Toda e qualquer tabela do banco (alunos, treinos, dietas, agendamentos, tarefas) deve conter a coluna `organization_id` (ou `academia_id`) e ter políticas de RLS ativas desde o primeiro script SQL[span_56](start_span)[span_56](end_span).
2. **Construção em Camadas:** Não introduzir integrações de hardware (catracas) ou agregadores (Gympass) antes que o núcleo de Auth, RLS e a Metodologia ARKE estejam 100% validados[span_57](start_span)[span_57](end_span).
3. **Sem Dados Mockados em Produção:** O sistema deve consumir estritamente dados em tempo real do Supabase ou exibir empty states claros.
4. **Ciclo Completo de Atendimento:** Uma pendência só é encerrada quando há um desfecho registrado (*Motivo → Responsável → Prazo → Ação → Desfecho → Próxima Checagem*)[span_58](start_span)[span_58](end_span).

## UX do Aluno & Diretrizes de Retenção Humanizada
- **Home Focada em Ação:** Prioridade para *Próxima Ação*, *Progresso Semanal*, *Próximo Evento de Acompanhamento* e *Botão de Ajuda*[span_59](start_span)[span_59](end_span). Dicas e gráficos ficam em segundo plano[span_60](start_span)[span_60](end_span).
- **Perguntas Construtivas:** Substituição de "Como está sua dedicação?" por "Como está sendo seguir seu plano?" (opções: Funcionando bem / Preciso de ajuste / Com dificuldade / Quero falar com alguém)[span_61](start_span)[span_61](end_span).
- **Gamificação Positiva (Fim da Punição):** Registros de dor, pedidos de ajuda ou faltas justificadas (viagem/trabalho) NÃO tiram pontos do aluno[span_62](start_span)[span_62](end_span). Rankings corporais (gordura/músculo) são proibidos nos painéis gerais, restritos apenas à evolução individual e privada do aluno[span_63](start_span)[span_63](end_span).
- **Constância vs. Adesão:** Aluno com meta de 2 treinos/semana que cumpre ambos tem 100% de constância; não deve ser penalizado em relação a quem treina 6 vezes[span_64](start_span)[span_64](end_span).

## Estrutura Comercial & Modelo de Atacado (Wholesale)

### Planos B2B (Assinatura de Plataforma para Academias)
- **Starter (Até 150 alunos ativos):** R$ 390/mês — Gestão operacional da metodologia, fila de atendimento básica, aplicativo da academia e treinamento da equipe local[span_65](start_span)[span_65](end_span)[span_66](start_span)[span_66](end_span).
- **Growth (Até 500 alunos ativos):** R$ 790/mês — Módulo completo de retenção (R.O.T.A.), versionamento de fichas, acompanhamento de adesão e suporte prioritário[span_67](start_span)[span_67](end_span)[span_68](start_span)[span_68](end_span).
- **Enterprise (Mais de 500 alunos ativos):** R$ 1.290/mês — Gestão multiunidade, relatórios avançados de churn e SLAs dedicados[span_69](start_span)[span_69](end_span)[span_70](start_span)[span_70](end_span).
- **Custom (Rede de Academias):** Sob consulta — Estruturas com personalização avançada de branding, suporte presencial dedicado e integrações sob demanda[span_71](start_span)[span_71](end_span)[span_72](start_span)[span_72](end_span).

### Licenças de Atacado / Níveis de Serviço do Aluno (Tabela Base ARKE)
- **Essencial (Treino ARKE):** Custo Atacado ARKE = R$ 15/aluno/mês — Onboarding M.A.P.A.®, treino individualizado, registro de dificuldades e evolução[span_73](start_span)[span_73](end_span)[span_74](start_span)[span_74](end_span).
- **Integrado (Treino + Nutrição):** Custo Atacado ARKE = R$ 45/aluno/mês — Tudo do Essencial + Plano alimentar individualizado, acompanhamento nutricional e revisão integrada[span_75](start_span)[span_75](end_span)[span_76](start_span)[span_76](end_span).
- **Integral (Acompanhamento 360°):** Custo Atacado ARKE = R$ 85/aluno/mês — Tudo do Integrado + Acolhimento expandido, jornada de hábitos completa, encontros periódicos e acompanhamento humano proativo[span_77](start_span)[span_77](end_span)[span_78](start_span)[span_78](end_span).
- *Nota de Negócio:* A academia define o valor final de varejo (markup) e o sistema realiza o Split Automático de Pagamento via gateway (Asaas)[span_79](start_span)[span_79](end_span)[span_80](start_span)[span_80](end_span).

## Motor de Automações e Regras Operacionais
- **Prevenção de Falha Humana:** Eventos da jornada viram tarefas automáticas com responsável, prazo (SLA) e prioridade[span_81](start_span)[span_81](end_span).
- **Sinais de Atenção Automáticos:**
  * Aluno sem 1º acesso após 48h → Tarefa de ativação[span_82](start_span)[span_82](end_span).
  * 2 treinos previstos sem registro → Tarefa de verificação de barreira[span_83](start_span)[span_83](end_span).
  * Relato de dor no treino → Alerta de revisão profissional antes do próximo treino[span_84](start_span)[span_84](end_span).
  * Resposta de atendimento atrasada → Escalonamento automático para o gestor da unidade[span_85](start_span)[span_85](end_span).
- **Proteção Anti-Duplicação e Idempotência:** Eventos repetidos não geram tarefas duplicadas. Pausas e cancelamentos encerram automações ativas imediatamente[span_86](start_span)[span_86](end_span).

## Arquitetura de Proteção e Resiliência Operacional
- **Versionamento Imutável:** Prescrições publicadas possuem snapshot travado (`versao_id`). Alterar modelos na biblioteca global não altera planos em uso por alunos[span_87](start_span)[span_87](end_span).
- **Sanitização de Dados:** Módulo de ingestão de arquivos CSV com validação rígida de e-mails, telefones e CPFs[span_88](start_span)[span_88](end_span).
- **Privacidade e LGPD:** Dados sensíveis (anamnese, fotos de avaliação corporal) possuem RLS estrito e acesso restrito ao profissional vinculado ao atendimento[span_89](start_span)[span_89](end_span).

## Sequência de Desenvolvimento (Phases)
- **Fase 1:** Reset do repositório, Setup SQL Unificado com Multitenant estrito, Auth e RLS por Tenant[span_90](start_span)[span_90](end_span).
- **Fase 2:** Onboarding M.A.P.A.® simplificado, UX de ajuda rápida e Anamnese de Acolhimento[span_91](start_span)[span_91](end_span)[span_92](start_span)[span_92](end_span).
- **Fase 3:** Prescrição e Versionamento Imutável de Treinos/Dietas[span_93](start_span)[span_93](end_span).
- **Fase 4:** Central de Atendimento "Minha Fila" (com registro obrigatorio de desfecho), Check-ins R.O.T.A.® e Automações de SLA[span_94](start_span)[span_94](end_span).
- **Fase 5:** Modulo de Margens/Markup por Academia, Split de Pagamento (Asaas) e Dashboards de Retenção Comercial[span_95](start_span)[span_95](end_span)[span_96](start_span)[span_96](end_span).
