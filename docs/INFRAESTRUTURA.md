# Infraestrutura do ArkeFit

Todos os serviços de que o ArkeFit depende, para que servem e onde fica a configuração de cada um. Atualizado em 25/09/2026, conferido nas contas e no DNS nesse dia.

**Este arquivo não tem segredo nenhum, e não pode ter.** O repositório é público. Aqui ficam os **nomes** das chaves e onde cada uma mora, nunca os valores. Logins, senhas, códigos de recuperação da verificação em duas etapas e o arquivo de chaves usado pelos scripts (variável `ARKE_CHAVES`) ficam no gerenciador de senhas. Veja [Como não depender de um lugar só](#como-não-depender-de-um-lugar-só).

## Mapa rápido

| Serviço | Para que serve | Plano hoje | Se cair |
|---|---|---|---|
| **Supabase** | Banco de dados, login, arquivos, funções do servidor e rotinas agendadas | Gratuito | O app inteiro para |
| **Vercel** | Publica o site e o app | Hobby | Site e app fora do ar; banco e cobranças seguem |
| **GitHub** | Código, testes a cada mudança e teste depois de cada publicação | Gratuito | Nada no ar para; só não sai versão nova |
| **Registro.br** | Domínio `arkefit.com.br` e o DNS dele | Anuidade | Site, app e e-mails deixam de ser encontrados |
| **Asaas** | Cobrança (cartão, PIX, boleto), divisão do pagamento entre ArkeFit e academia, nota fiscal da academia | Por transação | Ninguém paga; a conferência diária recupera o que se perder |
| **Resend** | Todos os e-mails: convite, senha, alertas, resumo semanal e a resposta automática ao contato do site | Gratuito | E-mails param; o app segue |
| **Amazon Web Services** (Bedrock) | IA: leitura de dieta em PDF, Sentinela e Vigia | Por uso | Os recursos de IA ficam "indisponível"; nada trava |
| **Cloudflare** (Turnstile) | Captcha dos formulários públicos | Gratuito | Os formulários seguem funcionando, sem captcha |
| **Sentry** | Avisa quando uma tela quebra no navegador de alguém e quando uma função do servidor dá erro | Gratuito | Nada para; perde-se o aviso |
| **UptimeRobot** | Avisa, de fora, quando o site, o app ou a plataforma saem do ar | Gratuito | Nada para; perde-se o aviso |
| **Hostinger** | E-mail do domínio `metodosarke.com.br` (e-mail comercial) | — | Só o e-mail comercial |

Os upgrades pagos (Supabase, Vercel e Resend) vêm antes do primeiro cliente pagante. A lista está em [LANCAMENTO_1_0.md](LANCAMENTO_1_0.md).

## Supabase

- **Organização:** MetodosArke.
- **Projeto em uso:** *ArkeFit PROD BR*, código `lzyxqjibkfblrrjboylp`, região `sa-east-1` (São Paulo). Endereço: `https://lzyxqjibkfblrrjboylp.supabase.co`.
- **Projeto antigo:** `jbkrxrfdrmrkyldrrdpq`, nos EUA (`us-west-2`), excluído em 25/09/2026. Tudo o que importava tinha passado para o novo, conforme [MIGRACAO_SUPABASE.md](MIGRACAO_SUPABASE.md).
- **Banco:** o esquema inteiro está em `supabase/migrations/`.
- **Login (Auth):**
  - endereço do app: `https://app.arkefit.com.br`;
  - os e-mails do Auth saem pela função `send-email`, ligada no hook de e-mail;
  - SMTP de reserva: `smtp.resend.com`;
  - verificação em duas etapas por aplicativo autenticador, obrigatória nas contas da ArkeFit;
  - **limite de e-mails do login: 500 por hora** no projeto inteiro. O padrão com SMTP próprio é 30, que uma importação de 400 alunos esgotava. Fica em Authentication → Rate Limits.
- **Arquivos (Storage):** nove espaços.
  - Privados: `atestados`, `chat-videos`, `dietas`, `termos-biometria`.
  - Públicos: `avatars`, `email-assets`, `exercicio-imagens`, `exercicio-videos`, `feed-images`.
- **Funções do servidor (Edge Functions):**
  - são 51, com o código em `supabase/functions/`;
  - quais respondem sem login está em `supabase/config.toml`;
  - cada Gateway de catraca faz ~100 mil chamadas por mês (escuta longa de ordens). Com 50 academias com catraca, passa das 2 milhões incluídas no Pro, e o excedente custa poucos dólares por mês;
  - publicar: `supabase functions deploy <nome> --project-ref lzyxqjibkfblrrjboylp`.
- **Rotinas agendadas (pg_cron):** 28. A `arke-agente-comercial` (de 5 em 5 minutos) é a resposta automática ao contato comercial (sozinha no site; nos outros canais, quando acionada), e só envia com ela ligada em Visão Master → Pipeline comercial. A `arke-retencao-historicos` apaga o histórico do próprio cron depois de 30 dias e resume os avisos do Asaas depois de 90. A situação de cada uma aparece em Visão Master → Webhooks, e uma rotina que falha manda e-mail aos Super Admins.
- **Cofre (Vault):**
  - quatro tokens que as rotinas usam para chamar as funções: `alerta_rotinas_token`, `briefing_semanal_token`, `lembrete_onboarding_token` e `reconciliacao_asaas_token`;
  - quando existirem, também moram aqui a chave da subconta Asaas de cada academia e as credenciais de Wellhub e TotalPass.
- **Backup:** o plano gratuito não tem. Vem com o Pro, e o ensaio de restauração está em [RESTAURACAO_BACKUP.md](RESTAURACAO_BACKUP.md).

### Segredos das funções do servidor

Ficam em Supabase → Project Settings → Edge Functions → Secrets. O Supabase mostra só o resumo (hash) de cada um, nunca o valor: **quem perde um valor tem de gerar outro no serviço de origem**.

| Nome | Para que serve | De onde vem |
|---|---|---|
| `ASAAS_API_KEY` | Falar com a conta Asaas de produção | Asaas → Integrações |
| `ASAAS_WEBHOOK_SECRET` | Conferir que o aviso veio do Asaas de produção | Gerado no painel de webhooks do Asaas; ele não mostra de novo |
| `ASAAS_SANDBOX_KEY` | Conta Asaas de testes, usada pelas academias em homologação | Sandbox do Asaas (começa com `$aact_hmlg_`) |
| `ASAAS_SANDBOX_WEBHOOK_SECRET` | Conferir os avisos do sandbox | Painel de webhooks do sandbox |
| `BEDROCK_ACCESS_KEY_ID`, `BEDROCK_SECRET_ACCESS_KEY` | Chamar a IA na AWS | Usuário IAM na AWS |
| `BEDROCK_MODEL_ID` | Modelo do Sentinela e da leitura de dieta (Claude 3 Haiku, em São Paulo) | Catálogo do Bedrock |
| `RESEND_API_KEY` | Enviar e-mail | Resend → API Keys |
| `SEND_EMAIL_HOOK_SECRET` | Conferir que o pedido de e-mail veio do Auth | Tem de ser o mesmo nas configurações do Auth e aqui |
| `TURNSTILE_SECRET_KEY` | Conferir o captcha no servidor. Apagar este segredo desliga o captcha sem publicar nada | Cloudflare → Turnstile |
| `VAPID_PRIVATE_KEY` | Notificação no celular; a chave pública é derivada dela | Gerada uma vez; trocar invalida as inscrições |
| `SITE_URL` | Endereço do app nos links dos e-mails | `https://app.arkefit.com.br` |
| `SENTRY_DSN_FUNCOES` | Mandar o erro 500 das funções ao Sentry (projeto `edge-functions`). Sem ele, as funções não mandam nada | Sentry → projeto `edge-functions` → Client Keys. É pública por desenho, como a do navegador |
| `CARTAO_RECORRENTE_ATIVO` | Interruptor da cobrança automática no cartão, do lado do servidor | Ligado por decisão dos sócios |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Nenhum código lê. Guardados por decisão do responsável, para uso futuro | Religar exige texto novo na Política, porque a OpenAI processa fora do Brasil |
| `CRON_SECRET` | Nenhum código lê. Sobra de uma função removida | Pode ser apagado |
| `SUPABASE_*` | Endereço e chaves do próprio projeto | Automáticos do Supabase |

## Vercel

- **Projeto:** `arke-fit`. Cada mudança que entra na `main` é publicada, e cada PR ganha um endereço de prévia.
- **Domínios:**
  - `www.arkefit.com.br`: a página de vendas e os documentos legais;
  - `app.arkefit.com.br`: o app;
  - `arkefit.com.br`: redireciona para o `www`;
  - `arke-system.vercel.app`: o endereço da própria Vercel.
- **Endereços repassados ao Supabase** (`vercel.json`): `/cadastro/<código>` (link curto de ativação) e `/manifest/<academia>` (o manifesto do app instalado com a marca da academia, da função `manifest-academia`).
- **Variáveis:** todas começam com `VITE_`, e **tudo o que começa com `VITE_` vai para o navegador**. Nunca pôr segredo nelas. Mudar uma variável só vale na publicação seguinte.

| Nome | Ambiente | O que faz |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | produção e prévia | Endereço do banco e a chave pública dele |
| `VITE_APP_HOST` | produção | Faz o app morar em `app.arkefit.com.br`. Apagar e publicar de novo desfaz |
| `VITE_TURNSTILE_SITE_KEY` | produção | Mostra o captcha nos formulários |
| `VITE_SENTRY_DSN` | produção | Liga o Sentry. Sem ela, o Sentry não sobe |
| `VITE_CARTAO_RECORRENTE` | produção e prévia | Mostra o cadastro de cartão para a cobrança automática |

## GitHub

- **Repositório:** `MetodosArke/arke-system`, **público**, com a branch principal `main`.
- **Testes a cada mudança** (`.github/workflows/ci.yml`): verificação do app, do Gateway das catracas e da ponte Topdata (num Windows).
- **Teste depois de cada publicação** (`.github/workflows/e2e.yml`): abre o app no ar e percorre a jornada do aluno.
- **Segredos do Actions:** `E2E_EMAIL` e `E2E_SENHA`, da conta de aluno de teste permanente. Não excluir essa conta.

## Domínios e DNS

**`arkefit.com.br`** está registrado no Registro.br, e o DNS também fica lá (`e.sec.dns.br` e `f.sec.dns.br`).

| Nome | Tipo | Aponta para | Para quê |
|---|---|---|---|
| `arkefit.com.br` | A | `216.198.79.1` (Vercel) | Redireciona para o `www` |
| `www` | CNAME | `bdcd07e5eb5d98ec.vercel-dns-017.com` | Página de vendas |
| `app` | CNAME | `bdcd07e5eb5d98ec.vercel-dns-017.com` | App |
| `arkefit.com.br` | MX | `inbound-smtp.sa-east-1.amazonaws.com` | E-mail recebido pelo Resend |
| `resend._domainkey` | TXT | Chave DKIM do Resend | Assinatura dos e-mails enviados |
| `send` | MX e TXT (SPF) | Servidores do Resend | Retorno e autorização dos e-mails enviados |
| `_dmarc` | TXT | `v=DMARC1; p=none` | Política de autenticação dos e-mails; melhora a entrega |

**`metodosarke.com.br`** tem o DNS na Vercel (`ns1.vercel-dns.com` e `ns2.vercel-dns.com`) e o e-mail na Hostinger (`mx1.hostinger.com` e `mx2.hostinger.com`). É o domínio do e-mail comercial.

## Asaas

- **Duas contas:** produção e sandbox (testes). Organização em homologação (trial) fala só com o sandbox, e a produção nunca cai no sandbox por engano.
- **Aviso de pagamento (webhook):** nas duas contas aponta para `https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/asaas-webhook`.
- **Token do webhook:** o Asaas mostra uma vez só. Perder o token significa gerar outro e gravá-lo nos dois lados, no Asaas e nos segredos do Supabase.
- **Conta de cada academia:** é uma subconta. A chave dela vai para o cofre do Supabase, e a carteira fica em `organizations.asaas_wallet_id`.
- **Conferência diária** com o banco às 04:30 UTC. Divergência e assinatura órfã aparecem na faixa vermelha da Visão Master.

## Resend

- **Domínio** `arkefit.com.br`: verificado, região `sa-east-1`, com envio e recebimento ligados e sem rastreamento de abertura nem de clique.
- **Remetentes usados pelo código:** `alertas@`, `relatorios@`, `convites@`, `suporte@`, `site@`, `ola@`, `noreply@`, `contato@`, `comercial@`, `implantacao@` e `acesso@arkefit.com.br`. Três podem ser trocados sem mexer no código, por variável das funções (não são segredos, e hoje nenhuma está definida): `EMAIL_IMPLANTACAO_FROM` (Bruno e o aviso de painel pronto do profissional autônomo), `EMAIL_SUPORTE_FROM` (chamado do assistente da academia) e `EMAIL_ACESSO_FROM` (aviso de matrícula a quem já tinha conta e o pedido de autorização ao responsável do aluno menor, `responsavel-pedido`).
- **Onde entra a chave do Resend:** no segredo `RESEND_API_KEY` e na senha do SMTP do Auth.

## Amazon Web Services (Bedrock)

- **Região** `sa-east-1` (São Paulo), **fixa no código** (`supabase/functions/_shared/ia.ts`).
- **Sentinela e leitura de dieta:** Claude 3 Haiku, que processa em São Paulo. É o valor de `BEDROCK_MODEL_ID`.
- **Vigia:** Claude Sonnet 4.6 pelo perfil global. É constante no código e só recebe dado técnico, nunca dado de aluno.
- **Assistente da academia (Lucas):** desde 03/10/2026 usa o mesmo modelo do Vigia (`MODELO_ASSISTENTE = MODELO_VIGIA`, perfil `global.`, fora do Brasil), com as mesmas credenciais. A pergunta sai sem CPF, e-mail, telefone e sem os nomes da academia (`nomes_para_anonimizar`). O interruptor é `plataforma_config.assistente_ia`; desligado, o assistente não chama a AWS.
- **Registro de invocações** na conta: desligado.
- **Acesso:** por um usuário IAM com as chaves `BEDROCK_*`. Em 23/09/2026 a conta ainda estava em verificação na AWS.

## Cloudflare (Turnstile)

- **Widget** no modo Managed, na conta da ArkeFit.
- **Chaves:**
  - a pública fica na Vercel (`VITE_TURNSTILE_SITE_KEY`);
  - a secreta fica no Supabase (`TURNSTILE_SECRET_KEY`).
- **Formulários protegidos:** matrícula pública, primeiro acesso e contato do site.

## Sentry

- **Organização** `arkefit`, dados nos EUA. Dois projetos:
  - `javascript-react`: o app no navegador, e os relatos da CSP (cabeçalho `report-uri` no `vercel.json`, pela chave pública dele);
  - `edge-functions` (desde 05/10/2026): o erro 500, 502 ou 504 das funções do servidor, mandado por `_shared/sentry.ts` com só o nome da função, o status, o tipo e o código do erro.
- **Monitor de disponibilidade:** fica no UptimeRobot, e não no Sentry (decisão do responsável, 05/10/2026). Detalhes na seção *Monitor de fora*. O monitor do Sentry na função `saude` foi criado e está desligado, porque o plano gratuito pede saldo de uso avulso para ligá-lo.
- **A chave pública (DSN)** fica na Vercel (`VITE_SENTRY_DSN`). É pública por desenho, porque vai no código do navegador.
- **Configuração:** está em `src/lib/monitoramento.ts` e não manda nome, e-mail, CPF nem gravação de tela.
- **Plano:** fica no gratuito, sem upgrade (decisão de 28/09/2026). As ocorrências de rotas `/api/trpc` que aparecem lá são de outro sistema que usa a mesma chave.

## UptimeRobot (monitor de fora)

O alerta de rotinas e o Vigia rodam dentro do Supabase: se o banco ou o pg_cron param, quem avisaria parou junto. O UptimeRobot pergunta de fora.

- **Conta:** MetodosArke, no plano gratuito, que pergunta de 5 em 5 minutos.
- **Monitores** (HTTP, tempo limite de 30 s), todos avisando o e-mail comercial:
  - `arkefit.com.br`, a página de vendas;
  - `app.arkefit.com.br`, o app;
  - a função pública `saude`, que responde 503 quando o banco não responde, quando o pg_cron para ou quando o alerta de rotinas para.
- **Chave da API:** `UPTIMEROBOT_API_KEY`, no arquivo de chaves do responsável. O plano gratuito cria monitor só pela API v3 (`api.uptimerobot.com/v3`, com `Authorization: Bearer`); a v2 recusa com "not allowed … current plan".
- Mais e-mails para avisar entram como contato de alerta no painel do UptimeRobot.

## Serviços usados sem conta

| Serviço | Para quê |
|---|---|
| BrasilAPI | Preencher CNPJ e CEP |
| HaveIBeenPwned (Pwned Passwords) | Recusar senha que já vazou em outro site, sem mandar a senha |
| Google Fonts | Fontes da página de vendas |

## Na máquina

- **Clone do repositório**, com Node, a CLI do Supabase (`supabase`) e a do GitHub (`gh`).
- **Arquivo de chaves** fora do repositório, apontado pela variável `ARKE_CHAVES`, que os scripts de `scripts/` leem. Guarda os tokens de acesso às contas no formato "nome numa linha, valor na seguinte". **Nunca entra no git.**
- **Bancada da Topdata**, só no computador em que ela roda: SDK Inner Acesso instalado em `C:\Windows\SysWOW64`, com o registro COM feito como administrador. Ver [PONTE_TOPDATA.md](PONTE_TOPDATA.md).

## Como não depender de um lugar só

1. **Este arquivo** fica no GitHub e em cada clone do repositório.
2. **Gerenciador de senhas** (Bitwarden, 1Password ou similar), com:
   - o login de cada conta;
   - os códigos de recuperação da verificação em duas etapas;
   - o arquivo de chaves.
   
   É a única cópia que importa dos segredos, porque nenhum serviço mostra um segredo de novo depois de criado.
3. **Duas pessoas administradoras** em cada conta (o responsável e um sócio). Assim ninguém fica trancado para fora se uma pessoa perder o acesso.
4. **Cada troca de serviço, domínio ou chave** atualiza este arquivo no mesmo PR.
