# Decisões e tarefas pendentes

Só o que continua em aberto. As decisões já tomadas e aplicadas saíram desta lista (a última rodada foi em 23/09/2026); o que cada uma mudou no sistema está registrado no `CLAUDE.md` e no histórico do git.

## Com o responsável, antes do primeiro cliente pagante

- **Canal de suporte.** Preencher em Visão Master → Configurações → Canal de suporte. Até lá o botão "falar com o suporte" não aparece em nenhuma etapa do onboarding, e um gestor que travar não tem para onde ligar de dentro do produto.
- **GIFs dos exercícios.** Os 105 exercícios globais continuam sem mídia. Os GIFs vêm do banco do app original; a estrutura de envio já existe e está testada. Vídeo é recurso a mais, não linha de base — a ficha se explica com GIF.
- **Infraestrutura paga** — Supabase Pro, Vercel Pro, Resend pago e Sentry conforme o volume — e, só depois dela, o **teste de carga**. Depois do upgrade do Supabase, trocar `limite_banco_mb` pelo disco contratado em Visão Master → Configurações.
- **Planilha real de exportação** (EVO, Tecnofit, Next Fit ou Pacto), para conferir o reconhecimento das colunas na importação de alunos.
- **Conta de teste da jornada do aluno.** Confirmar no GitHub que o teste de ponta a ponta `jornada-aluno` roda de verdade depois de cada deploy, e não aparece como "pulado".

## Vigia: o que passa a rodar (Fase 3)

- **A avaliação foi feita pelo simulado em 24/09/2026** (`npm run simulado:vigia`, resultados no `CLAUDE.md`), porque sem cliente em produção as duas semanas de sombra não teriam o que medir. O modo sombra continua ligado e registrando. Falta a decisão do responsável, regra a regra e ferramenta a ferramenta — sozinho, com aprovação, ou continuar em sombra. Até ela, nada executa. Recomendação:
  - **as 6 regras de nível 1 rodando sozinhas** — determinísticas, inofensivas mesmo quando a regra erra, com espera, limite de tentativas e freio;
  - **as 3 de nível 2 com aprovação de um clique** na Visão Master; a de aviso do Asaas agrupada por tipo de evento, para uma queda do Asaas virar um pedido, não um por aviso;
  - **a análise por IA como conselheira:** diagnóstico sempre visível, e as ações dela com aprovação, não sozinhas, até acumular casos reais — no simulado ela acertou, mas os cenários foram escritos por quem a escreveu.

## Depois do lançamento

- **Preço do profissional autônomo.** O plano Custom segue negociado caso a caso.
- **Venda de produtos e estoque.**

## Na implantação de cada cliente com catraca

- **Bancada de cada marca, com o equipamento de verdade:** sentido de giro da borboleta montada, tempo real de acionamento e do cadastro remoto da digital, mensagens de erro do firmware e, na Control iD, se o `uuid` do aviso de giro é o mesmo da identificação. O ensaio com o emulador prova a conversa; a primeira instalação prova o equipamento. Roteiro em `docs/MANUAL_GATEWAY_LOCAL.md` e `docs/PONTE_TOPDATA.md`.
- **Henry e Dimep:** a integração inteira, quando entrar o primeiro cliente com uma delas.
- **Topdata:** o Kit Integrador (suporte@topdata.com.br) roda a maior parte da bancada antes. E um ponto que só ela responde: na Topdata o aluno tem um número só no equipamento (o do cartão, ou o da digital), então quem quiser usar **cartão e digital ao mesmo tempo** precisa de dois números — o formato depende de como a digital da Topdata identifica o aluno.
- **Instalador do Gateway** gerado na implantação, sem assinatura de código: o Windows mostra o aviso do SmartScreen na primeira execução, e isso foi aceito.
