# Produto e princípios

A visão do sistema, a stack e os princípios, como estavam no CLAUDE.md até 05/10/2026. As regras vigentes, resumidas, estão no CLAUDE.md.

## Visão Geral do Sistema
O ARKE é uma plataforma SaaS B2B/B2C para academias, studios e personal trainers que combina software de acompanhamento com uma metodologia ativa de atendimento, treino e nutrição (M.A.P.A.®, R.O.T.A.®, APEX® e LEGADO®) para reduzir o churn evitável e incrementar a receita das academias parceiras[span_51](start_span)[span_51](end_span)[span_52](start_span)[span_52](end_span).

## Arquitetura e Stack
- **Frontend:** React + TypeScript, Vite, TailwindCSS, Shadcn/UI, Lucide React[span_53](start_span)[span_53](end_span).
- **Backend & Banco de Dados:** Supabase (Auth, PostgreSQL, Row Level Security - RLS, Storage, Edge Functions)[span_54](start_span)[span_54](end_span).
- **Hospedagem:** Vercel[span_55](start_span)[span_55](end_span).
- **Mapa de toda a infraestrutura** (serviços, domínios, DNS, nomes dos segredos e onde cada um mora, sem nenhum valor): `docs/INFRAESTRUTURA.md`. O repositório é público; o arquivo não leva segredo, login nem caminho de máquina. Cada troca de serviço, domínio ou chave o atualiza no mesmo PR.

## Princípios de Engenharia e Regras Estritas
1. **Multitenancy em Primeiro Lugar:** Toda e qualquer tabela do banco (alunos, treinos, dietas, agendamentos, tarefas) deve conter a coluna `organization_id` (ou `academia_id`) e ter políticas de RLS ativas desde o primeiro script SQL[span_56](start_span)[span_56](end_span).
2. **Construção em Camadas:** Não introduzir integrações de hardware (catracas) ou agregadores (Gympass) antes que o núcleo de Auth, RLS e a Metodologia ARKE estejam 100% validados[span_57](start_span)[span_57](end_span).
3. **Sem Dados Mockados em Produção:** O sistema deve consumir estritamente dados em tempo real do Supabase ou exibir empty states claros.
4. **Ciclo Completo de Atendimento:** Uma pendência só é encerrada quando há um desfecho registrado (*Motivo → Responsável → Prazo → Ação → Desfecho → Próxima Checagem*)[span_58](start_span)[span_58](end_span).

## UX do Aluno & Diretrizes de Retenção Humanizada
- **Home Focada em Ação:** Prioridade para *Próxima Ação*, *Progresso Semanal*, *Próximo Evento de Acompanhamento* e *Botão de Ajuda*[span_59](start_span)[span_59](end_span). Dicas e gráficos ficam em segundo plano[span_60](start_span)[span_60](end_span).

  > Implementação: `src/lib/proximaAcao.ts` (`definirProximaAcao`) decide o único bloco de topo da home do aluno, na ordem *ficha ainda não publicada* → *treinar hoje* → *check-in do dia* → *hidratação* → *em dia*. É função pura justamente para a regra ficar testável sem subir Supabase. "Em dia" é desfecho legítimo: sem ele a tela inventaria pendência só para ter o que mostrar, e quando a ficha ainda não saiu o card não oferece botão — a bola está com a academia, e mandar o aluno procurar algo que não existe seria pior do que dizer a verdade. Abaixo dela vêm Progresso Semanal, Próximo Evento, o check-in (`#check-in-do-dia`) e o registro de alerta; atalhos de navegação, água (`#diario-agua`) e pontuação de engajamento ficam no segundo plano, como manda a diretriz.
- **Perguntas Construtivas:** Substituição de "Como está sua dedicação?" por "Como está sendo seguir seu plano?" (opções: Funcionando bem / Preciso de ajuste / Com dificuldade / Quero falar com alguém)[span_61](start_span)[span_61](end_span).
- **Gamificação Positiva (Fim da Punição):** Registros de dor, pedidos de ajuda ou faltas justificadas (viagem/trabalho) NÃO tiram pontos do aluno[span_62](start_span)[span_62](end_span). Rankings corporais (gordura/músculo) são proibidos nos painéis gerais, restritos apenas à evolução individual e privada do aluno[span_63](start_span)[span_63](end_span).
- **Constância vs. Adesão:** Aluno com meta de 2 treinos/semana que cumpre ambos tem 100% de constância; não deve ser penalizado em relação a quem treina 6 vezes[span_64](start_span)[span_64](end_span).
