# Segurança da informação: controles e processos

Os controles de segurança da ArkeFit (METODOS ARKE LTDA) e os processos que os mantêm, na ordem dos itens 3 a 13 do Anexo I do contrato de Banking as a Service com o Asaas (Resolução Conjunta BCB/CMN nº 16/2025). Para cada item: o controle que existe, com o arquivo, a trava ou a rotina que o comprova, e o procedimento (quem faz, quando e onde fica o registro).

**O repositório é público.** Aqui ficam os controles e os procedimentos, nunca segredo, login, endereço de máquina nem a lista do que está aberto. As vulnerabilidades abertas e os incidentes em apuração ficam no registro privado dos sócios (seções 8 e 9).

**Quem mantém:** os sócios. O documento muda no mesmo PR de qualquer troca de processo, de terceiro ou de acesso, e é relido inteiro a cada 6 meses (a próxima em abril de 2027).

## Papéis

| Papel | Quem | O que faz aqui |
|---|---|---|
| **Sócios** | Os sócios da METODOS ARKE LTDA | Decidem: o incidente e a comunicação, o risco aceito, quem tem acesso a quê. Administram as contas dos provedores. |
| **Responsável técnico** | Um dos sócios | Opera a infraestrutura, acompanha os alertas, faz a triagem das vulnerabilidades e conduz o incidente até a decisão dos sócios. |
| **Agente de desenvolvimento** | Claude Code (Anthropic), em sessões abertas pelo responsável técnico | Escreve o código, as migrations e as provas, e opera a publicação, sob as regras do [CLAUDE.md](../CLAUDE.md) e desta página (seção 13). |
| **Encarregado de dados** | Indicado na Política de Privacidade | Fala com a ANPD e com os titulares. |

## 3. Gestão de acessos e identidades

**Controles que existem**

- **Menor privilégio por papel, no banco.** Cada tabela tem `organization_id` e RLS, com uma regra por tabela e operação. Na academia, gestão, professor, nutricionista e recepção veem cada um o seu recorte: o dinheiro só para quem cobra (`cuida_do_dinheiro()`), a saúde só para quem atende (`atende_saude()`, `tarefa_de_saude()`). Travas: `acessoPainel.guarda`, `tarefasPorDono.guarda`, `caixaDeMensagens.guarda`, `historicoDoAluno.guarda`.
- **A equipe da ArkeFit por nível.** Sócio, Suporte, Mentor, Comercial e Financeiro, em `equipe_arkefit.niveis`. O banco responde por área (`acesso_arkefit('<área>')`), e o nível nunca grava `user_roles`: só o Sócio tem o papel de administração. Ninguém escreve em `user_roles` pela API, e o último sócio não pode ser removido por caminho nenhum (`trg_user_roles_sempre_um_socio`). Travas: `acessosArkefit.guarda`, `equipeArkefit.guarda`.
- **Verificação em duas etapas.**
  - Toda conta da ArkeFit: o papel só vale com a sessão verificada (`has_role` no banco, `verificada(claims)` nas funções; `verificacao.guarda`).
  - Gestão da academia: exigida para exportar todos os dados, avisar o encerramento, trocar o e-mail de login de alguém e trocar a carteira de recebimento; opcional na entrada. Quem ligou passa pela regra restritiva "duas etapas" em toda tabela com dado de aluno (`duasEtapasNoBanco.guarda`).
- **Entrada só com o e-mail provado.** A equipe da ArkeFit entra por convite de um sócio verificado; a conta nasce sem senha, e a senha nasce no link do e-mail. Na academia, a conta que já existia entra pendente até a pessoa definir a senha pelo link (`identidade.guarda`).
- **Revogação imediata.** "Tirar o acesso" (`retirar_acesso_equipe_arkefit()`) tira os papéis, marca a pessoa como inativa, apaga as sessões e os tokens de renovação, registra na auditoria e avisa os outros sócios. O RLS lê o papel a cada pedido, então o token ainda válido deixa de abrir o que era da pessoa. Na academia, inativar o vínculo corta o acesso na hora.
- **Perfil simulado** só pelo Sócio com as duas etapas, auditado, e sem autorizar nada em nome da pessoa (`perfilSimulado.guarda`).
- **Senha:** conferida contra vazamentos públicos por k-anonimato (`senhaVazada.ts`), captcha nos formulários públicos (`_shared/captcha.ts`) e limite de tentativas por IP com o IP guardado só como hash.

**Procedimento: revisão de acessos**

- **Quando:** a cada trimestre (na primeira semana de janeiro, abril, julho e outubro); no mesmo dia em que alguém sai ou muda de função; e depois de todo incidente.
- **Quem:** um sócio faz, outro confere.
- **O que se confere, sistema por sistema:**

| Sistema | O que conferir | Como revogar |
|---|---|---|
| App ArkeFit, equipe da ArkeFit | Visão Master → Equipe ArkeFit: cada pessoa, o nível e o estado (só "Ativo" trabalha); as contas com papel de administração são só as dos sócios | **Tirar o acesso** |
| App ArkeFit, academias | A gestão de cada academia revisa a própria equipe (tela Equipe). A ArkeFit confere só o seu acesso a elas | A gestão inativa o vínculo |
| Supabase | Membros da organização e papéis; tokens de acesso pessoais; quem conhece os segredos das funções | Remover o membro; revogar o token; trocar o segredo |
| Vercel | Membros, tokens e variáveis | Remover; revogar |
| GitHub | Colaboradores, tokens, chaves de publicação e segredos do Actions | Remover; revogar |
| Asaas (produção e sandbox) | Usuários da conta, chaves de API e tokens de webhook | Remover o usuário; gerar chave nova (seção 4) |
| AWS | Usuários IAM e chaves de acesso; a conta raiz | Desativar a chave; remover o usuário |
| Anthropic (Console) | Membros e chaves de API | Revogar a chave |
| Resend, Cloudflare, Sentry, UptimeRobot | Membros e chaves | Remover; revogar |
| Registro.br, e-mail do domínio | Quem administra o domínio e as caixas | Trocar a senha; remover o acesso |
| Gateways das catracas | Um token por equipamento, guardado só como hash | Gerar token novo na tela Catracas |
| Agente de desenvolvimento | As credenciais que as sessões dele alcançam (seção 13) | Revogar o token no provedor |

- **Em cada conta de provedor**, a revisão confere também a verificação em duas etapas ligada e pelo menos duas pessoas administradoras, para ninguém ficar trancado para fora.
- **Saída de alguém:** no mesmo dia, "Tirar o acesso" no app, remover a pessoa de cada provedor da tabela, trocar os segredos que ela conhecia e registrar.
- **Registro:** uma seção "Revisão de acessos, <data>" em [`registro/seguranca-e-acesso.md`](registro/seguranca-e-acesso.md), com os sistemas revistos, o número de contas em cada um e o que mudou, sem nome nem e-mail. A lista nominal fica com os sócios, fora do repositório.

## 4. Proteção de chaves de API e credenciais

**Controles que existem**

- **Segredo de produção só no cofre do provedor.** As chaves que a plataforma usa (Asaas, AWS, Resend, Anthropic, captcha, webhooks) ficam nos segredos das funções do Supabase, que mostram só o resumo, nunca o valor. Os tokens das rotinas e a chave da conta Asaas de cada academia ficam no Vault do Supabase, cifrado. A Vercel guarda só o que é público por desenho (prefixo `VITE_`). Os nomes estão em [INFRAESTRUTURA.md](INFRAESTRUTURA.md); os valores, nunca.
- **Nada no repositório.** `.env*` fora do git, e o GitHub confere cada envio com a varredura de segredos e o bloqueio no envio (*secret scanning* e *push protection*).
- **A chave do Asaas só pelo `ambienteAsaas`** (`_shared/asaas.ts`, `ambienteAsaas.guarda`). Organização em homologação fala só com o sandbox, e a chave do sandbox é conferida pelo prefixo antes de qualquer chamada. A produção nunca cai no sandbox, e o sandbox nunca usa a chave de produção.
- **Webhook do Asaas conferido** a cada aviso (`webhookAsaas.guarda`). O token do webhook da conta de cada academia é guardado só como hash. O mesmo vale para o token dos Gateways das catracas (`tokenCatraca.guarda`).
- **A plataforma não faz saque nem transferência pela API do Asaas.** Nenhuma função chama esses recursos; o dinheiro sai da conta só pelo painel do Asaas.
- **Segredo não vai para log nem para o monitoramento.** O Sentry tira token, `Bearer` e chave do Asaas do texto (`monitoramento.guarda`), e o log das funções leva só `resumoDoErro()` (`logsSemDadoPessoal.guarda`).
- **As credenciais de administração** das contas dos provedores ficam fora do repositório, sob a guarda do responsável técnico. Os scripts recebem o caminho do arquivo (`ARKE_CHAVES`), leem a chave dentro do processo e nunca imprimem o valor.

**Procedimento**

- **Acesso:** só os sócios leem ou trocam os segredos de produção.
- **Troca programada:** a chave de API do Asaas de produção e as chaves da AWS são trocadas a cada 12 meses; todas, quando alguém que as conhecia sai.
- **Chave comprometida ou suspeita** (vazou, apareceu num log, saiu numa mensagem, o computador foi perdido):
  1. revogar a chave no provedor e gerar outra, na hora;
  2. gravar a nova nos segredos do Supabase (`supabase secrets set`) e conferir com uma chamada de verdade;
  3. **se for do Asaas** (chave de API ou token de webhook): comunicar o Asaas imediatamente, e no máximo em 24 horas, pelo prevencao@asaas.com.br (Anexo I, item 4.2), e conferir no painel do Asaas as cobranças, as transferências e os saques do período;
  4. tratar como incidente (seção 8).
- **Saque e transferência** da conta Asaas da ArkeFit: só por um sócio, pelo painel do Asaas.

## 5. Segregação de ambientes

**Como os ambientes estão separados**

| Ambiente | Onde | Credenciais |
|---|---|---|
| Desenvolvimento | O clone do repositório, numa cópia de trabalho por tarefa | As do responsável técnico (seções 4 e 13) |
| Testes automatizados | O CI do GitHub e a máquina: os testes do app, as travas, o `deno check` das funções e o banco em Postgres local (PGlite), com as regras de acesso geradas das migrations | Nenhuma: os testes não falam com o banco de produção |
| Homologação | As organizações em `trial`, dentro do projeto de produção, isoladas por organização e RLS; a cobrança delas vai só ao sandbox do Asaas. A academia de testes automáticos e a de demonstração (fictícia) são permanentes | O sandbox do Asaas tem chave e token de webhook próprios |
| Produção | O projeto Supabase em São Paulo, a Vercel e a conta Asaas de produção | As do cofre (seção 4) |

**Mudanças controladas**

- **Todo código entra por PR.** O CI roda três trabalhos a cada PR (`check`, `gateway`, `ponte-topdata`; `.github/workflows/ci.yml`), e o merge na `main` só acontece com os três verdes. A Vercel publica a `main`, e o teste de ponta a ponta roda contra produção depois de cada publicação (`.github/workflows/e2e.yml`).
- **Migration** segue a numeração do repositório, começa com `set lock_timeout` (`migrations.guarda`) e é provada no banco em transação desfeita antes de ser aplicada. A ordem e o texto do que rodou ficam em `supabase/historico/` (`historicoBanco.guarda`).
- **Edge functions** são publicadas pela CLI do Supabase, com o código do PR; a versão publicada fica no registro da entrega.
- **Registro:** cada entrega tem uma seção em [`registro/`](registro/README.md), com o porquê, o defeito do caminho e a linha "Conferido". O git guarda quem mudou o quê e quando.
- **Prova em produção** só em transação desfeita, ou com contas e academias temporárias apagadas no fim. As contas e as academias permanentes de teste não são tocadas.

## 6. Proteção de dados e criptografia

- **Em trânsito:** tudo por HTTPS: o app (a Vercel manda o HSTS), o Supabase, o Asaas, os provedores de IA e de e-mail, e o Gateway da academia falando com a nuvem.
- **Em repouso:** o banco e os arquivos do Supabase são cifrados pelo provedor (AES-256); os segredos ficam no Vault e nos segredos das funções, cifrados.
- **O que nem é guardado em claro:** a senha (bcrypt, no Auth); o IP do limite de tentativas (SHA-256 com pimenta); os tokens dos Gateways e do webhook da academia (hash); o cartão (só os 4 últimos dígitos e a bandeira; o aviso do Asaas é reduzido ao que o webhook lê, `avisoAsaas.guarda`); a biometria (fica só nos equipamentos da academia).
- **Gestão de chaves:** as chaves de criptografia em repouso são do provedor. As chaves de aplicação seguem a seção 4.
- **Segregação lógica entre clientes:**
  - toda tabela tem `organization_id` e RLS ligado (`rlsSemRegra.guarda` cobra o RLS de toda tabela do `public`);
  - função `security definer` que recebe id de aluno ou de academia confere quem chama, e a leitura que junta tabelas para a tela segue o RLS de quem pede;
  - os arquivos ficam em pastas por academia e por aluno, com as regras do Storage (`bucketsBanco.guarda`).
- **Minimização:** o Sentry e os logs não levam nome, e-mail, CPF nem saúde; a IA com dado de aluno roda no Brasil (`iaNoBrasil.guarda`); a saúde fica com quem atende; o dado do menor depende do aceite do responsável.

## 7. Monitoramento, logs e rastreabilidade

**O que se registra**

| Registro | O que guarda | Onde | Por quanto tempo |
|---|---|---|---|
| Trilha de auditoria | Ações sensíveis: perfil simulado, saída de aluno, troca de e-mail, papel ou nome, convite e retirada da equipe ArkeFit, troca da carteira, mudança de preço e repasse, link de acesso, encerramento, leitura dos registros de acesso. Quem, sobre quem, quando e o quê, sem e-mail nos detalhes | `auditoria_acoes_sensiveis` | Sem apagamento |
| Registros de acesso (Marco Civil, art. 15) | IP, data e hora, por pessoa e por dia | `registros_acesso_aplicacao` | 6 meses (rotina `arke-registros-de-acesso`) |
| Prova dos consentimentos | Quem, quando, a versão e o hash do texto, o navegador | As tabelas de consentimento e de aceite | Enquanto for preciso provar |
| Avisos do Asaas | Reduzidos ao que o webhook lê | `asaas_webhook_events` | 13 meses |
| Rotinas agendadas | Cada execução e o desfecho | `cron.job_run_details`, `execucoes_agendadas` | 30 dias no cron |
| Uso de IA | Agente, modelo, tokens e custo | `ia_chamadas` | 13 meses |
| Erros | Do navegador e das funções, sem dado pessoal | Sentry | O do plano do provedor |
| Plataforma | Logs do Supabase e da Vercel | Os provedores | O do plano do provedor |
| Código e banco | Cada mudança, quem fez e quando | git, `supabase/historico/`, `docs/registro/` | Sem apagamento |

**Proteção contra alteração e exclusão.** A trilha de auditoria e os registros de acesso não têm regra de escrita pela API: só as funções do servidor gravam, e ninguém altera nem apaga pela aplicação. A auditoria é lida só pelos sócios. Os registros de acesso não são lidos pela API, e a consulta, só diante de ordem judicial, vai ela mesma para a auditoria.

**Quem vigia, e como avisa**

- **UptimeRobot**, de fora, de 5 em 5 minutos: a página de vendas, o app e a função `saude`, que acusa banco, pg_cron ou alerta de rotinas parados.
- **Alerta de rotinas**, de hora em hora: e-mail aos sócios e ao Suporte quando uma rotina falha ou para de rodar, e de novo quando volta.
- **Vigia**, a cada 10 minutos: a saúde técnica (Gateways, rotinas, webhooks), com resumo diário às 8h. Não lê dado de aluno.
- **Sentry:** erro de tela e erro 5xx das funções, com aviso por e-mail.
- **Conferência diária com o Asaas** (04:30 UTC): divergência e assinatura órfã viram faixa vermelha na Visão Master.
- **Alerta de catracas:** o gestor é avisado quando a catraca dele sai do ar.

**Procedimento.** O responsável técnico lê os avisos no dia em que chegam e abre a Visão Master todo dia útil. Aviso que pode ser incidente segue a seção 8.

## 8. Gestão de incidentes

**Incidente de segurança** é qualquer evento, confirmado ou suspeito, que comprometa a confidencialidade, a integridade ou a disponibilidade dos dados ou da plataforma: dado de aluno exposto, conta tomada, chave vazada, cobrança indevida, acesso entre academias, plataforma fora do ar.

**1. Detecção.** Pelos avisos da seção 7 (UptimeRobot, alerta de rotinas, Vigia, Sentry, conferência do Asaas, alerta de catracas), pela varredura de segredos do GitHub, pela trilha de auditoria, ou por relato de uma academia, de um aluno, do Asaas ou de outro provedor. Quem percebe avisa o responsável técnico na hora, por telefone ou mensagem.

**2. Abertura.** O responsável técnico abre o registro do incidente com a hora em que a ArkeFit soube. É dela que contam os prazos.

**3. Classificação**

| Nível | Quando | Exemplos |
|---|---|---|
| **Crítico** | Dado pessoal exposto ou alterado; credencial de produção comprometida; cobrança ou movimentação indevida; plataforma inteira fora do ar por mais de 1 hora | Chave do Asaas num lugar público; uma academia lendo aluno de outra |
| **Alto** | Suspeita forte ainda não confirmada; falha de controle de acesso sem sinal de uso; indisponibilidade parcial | Regra de acesso larga demais achada numa auditoria |
| **Baixo** | Falha técnica sem dado pessoal e sem dinheiro | Rotina parada, recuperada pela repetição |

**4. Contenção**, na hora, sem esperar a decisão: revogar a chave (seção 4), tirar o acesso da conta (seção 3), desligar a função ou o interruptor do recurso, publicar a correção. O que for apagado ou trocado é anotado antes, para a apuração.

**5. Decisão.** Os sócios decidem a comunicação, a correção definitiva e o risco que fica. No incidente crítico, decidem no mesmo dia; se um sócio não responde, decide quem estiver disponível, e o outro é informado depois.

**6. Comunicação**

| Para quem | Quando | Como |
|---|---|---|
| **Asaas** | Imediatamente, e no máximo em 24 horas da identificação, todo incidente que possa afetar os serviços, os dados, os sistemas ou a operação regulada, e todo indício de fraude, uso indevido ou risco regulatório, financeiro ou reputacional (contrato BaaS, cláusula 8.2.1 e Anexo I, item 8.2). Na dúvida, comunicar | E-mail a prevencao@asaas.com.br: o que aconteceu, quando, o que foi afetado, o que já foi contido, e o contato da ArkeFit. A ArkeFit coopera com a investigação do Asaas e preserva as evidências |
| **Academia** | Em até 48 horas da ciência, quando o incidente pode acarretar risco ou dano relevante aos alunos dela (Contrato da Academia, cláusula 6, item 5). Nos dados do atendimento, a academia é a controladora e comunica a ANPD e os alunos, com o apoio da ArkeFit | E-mail à gestão da academia, com as informações para ela cumprir o dever dela |
| **ANPD** | Em até 3 dias úteis do conhecimento de que o incidente afetou dados pessoais, quando pode acarretar risco ou dano relevante (Resolução CD/ANPD nº 15/2024, arts. 5º e 6º), nos dados de que a ArkeFit é controladora: o Método ARKE, as contas das academias e da equipe | Formulário eletrônico da ANPD, pelo encarregado, com as informações do art. 6º, § 2º; o complemento, em até 20 dias úteis |
| **Titulares** | No mesmo prazo de 3 dias úteis e no mesmo caso (art. 9º) | E-mail e aviso no app, em linguagem simples: o que aconteceu, os dados, os riscos, o que foi feito e o que a pessoa pode fazer |

A ArkeFit conta esses prazos sem a dobra do agente de pequeno porte (art. 6º, § 8º): o tratamento de dado de saúde, de biometria e de menor de idade pode caracterizar alto risco, que tira esse benefício (Resolução CD/ANPD nº 2/2022, arts. 3º e 4º).

**7. Erradicação e volta.** A correção entra por PR, como toda mudança (seção 13), com a trava que impede a volta do defeito. A recuperação de dados segue a seção 12.

**8. Registro.** O registro de cada incidente, inclusive o que não foi comunicado, fica com os sócios, fora do repositório, por no mínimo 5 anos (Resolução CD/ANPD nº 15/2024, art. 10): a cronologia, a classificação, os dados e as pessoas afetadas, as decisões, as comunicações feitas e as provas.

**9. Lições.** Em até 15 dias do encerramento, o incidente vira uma seção em [`registro/`](registro/README.md), sem dado pessoal nem detalhe explorável: a causa, a correção e a trava nova. Mudou processo, muda esta página.

**Ensaio:** uma vez por ano, os sócios percorrem um incidente simulado (uma chave do Asaas vazada, por exemplo) do aviso ao registro, e anotam o tempo de cada passo.

## 9. Gestão de vulnerabilidades

**Fontes**

- **A cada PR, no CI:** a auditoria das dependências de produção do app e do Gateway (`npm run auditar`, dentro do `npm run check`, reprova aviso alto ou crítico); os tipos, o lint e o `deno check` das funções; e as travas `*.guarda.test.ts`, que falham se uma armadilha conhecida voltar (69 em 13/10/2026).
- **A cada envio ao GitHub:** a varredura de segredos, com bloqueio no envio.
- **Os avisos de segurança do Supabase** (*Security Advisor*), conferidos a cada semana e depois de cada migration que cria tabela ou função.
- **O Sentry:** erro novo é lido no dia, e o que sugerir falha de acesso vai para a triagem.
- **As auditorias de prontidão:** uma revisão completa, do banco para cima, a cada 6 meses e antes de cada marco (primeiro cliente, primeira catraca).
- **Relato de fora:** academia, aluno, provedor ou pesquisador, pelo e-mail de suporte.

**Classificação e prazos**

| Nível | Quando | Prazo para corrigir |
|---|---|---|
| **Crítica** | Explorável sem login, ou por qualquer conta, levando a dado de outra academia, dado de saúde, dinheiro ou credencial | Conter em 24 horas e corrigir em até 72 horas. É também incidente (seção 8) |
| **Alta** | Pede uma conta da academia ou uma condição específica; ou dependência com aviso alto ou crítico | 7 dias (a dependência já reprova o PR) |
| **Média** | Impacto limitado ou com outra barreira na frente | 30 dias |
| **Baixa** | Higiene, defesa em profundidade | 90 dias, ou aceita pelos sócios com o motivo registrado |

**Responsáveis.** O responsável técnico faz a triagem e a classificação no dia em que a vulnerabilidade é conhecida e conduz a correção. Aceitar um risco, ou estender um prazo, é decisão dos sócios.

**Registro.** A vulnerabilidade aberta fica no registro privado dos sócios, fora do repositório, com a data, a fonte, o nível, o prazo e o responsável. Corrigida, ela entra no registro público da entrega (`docs/registro/`), com o porquê, o defeito plantado que prova a trava e a linha "Conferido". Nenhuma correção vai a produção sem o CI verde.

## 10. Auditoria

- A ArkeFit coopera com as auditorias do Asaas e de quem ele indicar, e responde ao pedido de evidência em até 10 dias úteis.
- **As evidências disponíveis:** esta página; o histórico do git e dos PRs, com o resultado do CI de cada um; o registro das entregas (`docs/registro/`); o retrato do banco (`supabase/historico/`); a trilha de auditoria, lida pelos sócios na Visão Master; os registros de acesso, consultados por SQL com a consulta registrada na auditoria; as revisões de acesso, os registros de incidente e de vulnerabilidade; os ensaios de restauração ([RESTAURACAO_BACKUP.md](RESTAURACAO_BACKUP.md)).
- **Quem atende:** os sócios. Dado pessoal só vai ao auditor quando for indispensável e pelo meio combinado com ele.

## 11. Gestão de terceiros

**Inventário**

| Provedor | O que trata | Onde processa | Contrato de dados |
|---|---|---|---|
| **Supabase** | Banco, login, arquivos e funções: todos os dados da plataforma, inclusive saúde | Brasil (São Paulo) | Termos e DPA do provedor |
| **Asaas** | Cobrança, divisão do pagamento, nota fiscal das academias; nome, CPF, e-mail e endereço de quem paga | Brasil | Contrato com o Asaas, inclusive o de BaaS |
| **Amazon Web Services** (Bedrock) | IA com dado de aluno (resumo da anamnese, rascunho do mentor, dieta em PDF, resposta ao contato do site); a reserva do Vigia e do assistente, sem identificação | São Paulo; a reserva, na infraestrutura global | DPA da AWS, que a AWS declara conforme o art. 33, II, da LGPD |
| **Anthropic** (API) | O Vigia (só dado técnico) e o assistente da academia (a dúvida sem identificação) | Estados Unidos | DPA com as cláusulas-padrão da ANPD incorporadas, confirmado por escrito em 09/10/2026 |
| **Anthropic** (Claude Code) | O agente de desenvolvimento e operação (seção 13) | Estados Unidos | Os termos da Anthropic do plano contratado |
| **Vercel** | Hospedagem do app e da página de vendas; o IP de quem acessa | Estados Unidos e global | DPA do provedor; as cláusulas da ANPD foram perguntadas em 09/10/2026 |
| **Resend** | E-mails: nome, e-mail e o texto da mensagem | Estados Unidos | DPA do provedor, sem as cláusulas da ANPD; os e-mails do serviço se apoiam no art. 33, IX, da LGPD |
| **Sentry** | Erros, sem nome, e-mail, CPF nem saúde: só códigos internos | Estados Unidos | DPA do provedor; as cláusulas da ANPD foram perguntadas em 09/10/2026 |
| **Cloudflare** (Turnstile) | Captcha: sinais do navegador e IP | Global | Termos do provedor |
| **GitHub** | Código e CI; nenhum dado pessoal de aluno | Estados Unidos | Termos do provedor |
| **UptimeRobot** | Só a disponibilidade dos endereços | Global | Sem dado pessoal |
| **Registro.br** | Domínio e DNS | Brasil | Contrato de registro |
| **Hostinger** | E-mail comercial | — | Termos do provedor |
| **Google** (Fonts, YouTube), **BrasilAPI**, **Have I Been Pwned** | Fontes e vídeos (o IP do navegador); CEP e CNPJ; o prefixo do hash da senha | — | Sem contrato; a Política de Privacidade os cita |

**Procedimento**

- **Antes de contratar:** o que o provedor vai tratar e onde; o DPA e as cláusulas-padrão da ANPD (Resolução CD/ANPD nº 19/2024), quando o dado sai do país; os relatórios de segurança dele (SOC 2, ISO 27001); se oferece duas etapas e controle de acesso. Os sócios decidem.
- **Antes de ligar:** a Política de Privacidade cita o provedor quando ele trata dado pessoal (a regra que já valeu para a Anthropic no assistente), e o provedor entra nesta tabela e em [INFRAESTRUTURA.md](INFRAESTRUTURA.md), no mesmo PR.
- **Obrigações equivalentes:** o provedor que trata dado pessoal se obriga, pelo contrato dele, a confidencialidade, segurança e aviso de incidente; o que não se obriga fica registrado aqui, com a base legal que sustenta o uso.
- **Revisão anual** (em outubro): os termos, o DPA, os subprocessadores e os incidentes de cada provedor; o resultado vai para o registro.

## 12. Backup e recuperação de desastres

**O que já existe**

- **O esquema do banco se reconstrói do repositório.** `supabase/historico/` guarda a ordem e o texto de cada migration que rodou, e `scripts/migracao/replicar-schema.mjs` (`ARKE_ORIGEM=repositorio`) aplica tudo num projeto vazio. O roteiro `scripts/migracao/02-depois-da-restauracao.sql` refaz as rotinas, os tokens e os buckets, e `scripts/migracao/comparar.mjs` compara dois bancos objeto a objeto.
- **O registro do dinheiro também mora no Asaas.** Cobranças, pagamentos e notas ficam na conta do Asaas, e a conferência diária reconcilia o banco com ele.
- **O código** fica no GitHub e em cada clone.
- **As catracas seguem sem a nuvem**, pela lista local do Gateway (contingência offline).

**A política, com o Supabase Pro**

- **Backup diário** do banco pelo Supabase, guardado 7 dias (o do plano Pro). A volta a qualquer momento do dia (PITR) não foi contratada (decisão de 24/09/2026) e é revista quando a operação crescer.
- **Cópia fora do Supabase:** uma cópia lógica diária do banco (`pg_dump`) e dos arquivos do Storage, cifrada antes de sair, num bucket da conta AWS da ArkeFit em São Paulo, com versões e bloqueio de exclusão, guardada 30 dias. Ela roda dentro da AWS em São Paulo, para o dado de saúde não sair do país, e cobre o que o backup do Supabase não cobre: a perda do projeto ou da conta, e os arquivos do Storage.
- **Quem pode restaurar:** só os sócios.

**Objetivos**

| Cenário | RPO (quanto dado se pode perder) | RTO (em quanto tempo volta) |
|---|---|---|
| Dado apagado ou corrompido, projeto de pé | 24 horas: o intervalo do backup diário | 4 horas: restaurar no próprio projeto e conferir |
| Perda do projeto ou da conta do Supabase | 24 horas: o intervalo da cópia diária | 24 horas: projeto novo, a cópia, o roteiro de depois da restauração, os segredos e os tokens do Vault, as 57 funções, a configuração do login, as variáveis da Vercel, os webhooks do Asaas e o endereço dos Gateways |

**Por que esses números.** 24 horas de RPO é o que o backup diário entrega, e o dano dele é limitado: o estado das cobranças volta do Asaas pela conferência diária, e o que se perde são os registros de um dia no app (treinos, mensagens, check-ins), que o aluno e a equipe refazem. O RTO de 4 horas cabe num dia de operação da academia, que tem a catraca na lista local nesse meio tempo. O de 24 horas segue a lista de passos que a mudança do projeto para São Paulo, em setembro de 2026, mostrou ser necessária. **Os números do RTO são propostas: os de verdade saem do ensaio**, e esta tabela muda com o primeiro.

**Ensaio de restauração.** Logo depois da contratação do Pro e antes do primeiro cliente pagante; depois, a cada 6 meses e depois de toda mudança grande de infraestrutura. Restaura num projeto novo, nunca no de produção, mede o tempo, confere o conteúdo e apaga o projeto restaurado. Os passos e o registro de cada ensaio (data, tempo de volta, conferência e quem fez) ficam em [RESTAURACAO_BACKUP.md](RESTAURACAO_BACKUP.md). A cópia de fora do Supabase entra no ensaio uma vez por ano.

## 13. Desenvolvimento seguro

- **Segurança desde o desenho.** As regras vigentes do [CLAUDE.md](../CLAUDE.md) valem para toda entrega: multitenancy primeiro, RLS desde o primeiro script, uma regra por tabela e operação, função `security definer` que confere quem chama, nenhum dado inventado em produção. Cada armadilha que já custou caro tem uma trava (`src/lib/*.guarda.test.ts`) que lê o código e as migrations e falha se ela voltar; cada trava é provada com um defeito plantado de propósito.
- **Codificação segura**, com trava: o erro das funções sem dado pessoal e sem a mensagem crua do banco ou do Auth (`logsSemDadoPessoal.guarda`, `respostaSemErroInterno.guarda`); sorteio sem `Math.random()` (`aleatorio.guarda`); prazo em toda chamada externa (`prazoChamadas.guarda`, `prazoIA.guarda`); freio nas funções que chamam o Asaas e a IA (`freio.guarda`); idempotência nos e-mails (`emailIdempotente.guarda`); cabeçalhos de segurança e política de conteúdo (`cabecalhos.guarda`).
- **Versionamento:** git, PR por entrega, migrations numeradas com o retrato do que rodou, documentos legais com versão e hash (`documentosLegais.test.ts`).
- **Separação de ambientes:** seção 5.
- **Revisão:** cada PR passa pelo CI (tipos, lint, `deno check`, auditoria das dependências, testes e travas) e só vai para a `main` com os três trabalhos verdes. A entrega se prova em camadas antes do registro: o banco em transação desfeita, a corrente real pelas funções publicadas, a tela no computador e no celular, e um defeito plantado. Mudança de regra de acesso, de dinheiro ou de dado pessoal passa pela decisão dos sócios antes de ser feita.
- **Correção antes de produção:** o CI reprova dependência com aviso alto ou crítico; a migration é provada em transação desfeita antes de ser aplicada; o teste de ponta a ponta roda depois de cada publicação.

**O agente de desenvolvimento.** O código e a operação são feitos com o Claude Code, da Anthropic, em sessões abertas pelo responsável técnico na máquina dele, com as credenciais dele. As regras que o cercam:

- ele segue o CLAUDE.md e esta página, e as travas do CI valem para o que ele escreve como para qualquer pessoa;
- o merge na `main` só acontece com os três trabalhos do CI verdes;
- nas contas da ArkeFit no app, o papel só vale com as duas etapas, que pedem o aplicativo autenticador da pessoa: o agente não abre sessão de sócio;
- as ações sensíveis feitas pelo app vão para a trilha de auditoria;
- os segredos são lidos só dentro dos scripts, pelo caminho do arquivo, e nunca impressos na sessão;
- prova em produção só em transação desfeita, ou com contas e academias temporárias apagadas no fim;
- decisão de produto, de dinheiro, de acesso e de risco é dos sócios: o agente prepara e registra, e não decide.
