# Migração do banco: `jbkrxrfdrmrkyldrrdpq` (us-west-2) → `lzyxqjibkfblrrjboylp` (sa-east-1)

Projeto novo: **ArkeFit PROD BR**, São Paulo. O motivo é a política de
privacidade, que passou a declarar o banco no Brasil.

**Estado em 22/09/2026: o projeto novo está pronto e conferido. A produção
ainda aponta para o antigo.** O que falta são três passos que só você consegue
dar, listados em "A virada".

---

## O que foi feito, e por que assim

### Schema, sem `pg_dump`

O caminho normal seria um dump do banco antigo, que pede a senha do banco — e
ela não estava disponível. O caminho usado dispensa senha: **o próprio Supabase
guarda o SQL de cada migration aplicada** em
`supabase_migrations.schema_migrations.statements`. A partir de
`reset_schema_public`, que derrubou o schema anterior inteiro, essa lista é a
história completa do banco atual.

`scripts/migracao/replicar-schema.mjs` lê essa lista na origem e aplica no
destino, em ordem, pela API de gerenciamento. Das 161 migrations, 155 vieram do
banco e 6 — as rodadas 5, 6 e final, aplicadas por `supabase db query`, que não
grava o SQL na tabela — vieram do arquivo no repositório. O script **para antes
de tocar no destino** se faltar SQL para alguma: migrar sem saber o que falta é
pior do que não migrar.

Duas coisas deram trabalho e valem registro:

- **Regra de RLS renomeada fora de migration.** A migration de consolidação foi
  gerada a partir do estado real da produção, então ela manda remover regras
  pelo nome que elas têm *lá*. Uma delas tinha sido renomeada à mão, e na
  reconstrução esse nome nunca existiu — o `drop` abortava a migration inteira.
  O script passou a tolerar remoção de objeto ausente, e a regra antiga que
  sobrou no destino foi removida depois, pela comparação.
- **Ordem por carimbo de data.** As migrations das rodadas 5 e 6 usam datas
  fictícias no futuro (`2026-12-11`), e a de storage, aplicada hoje, recebeu o
  carimbo real (`2026-09-22`). Pela ordem de versão, ela caía **antes** das
  funções de que depende. O carimbo na origem foi corrigido para bater com o
  nome do arquivo. Fica a lição: migration nova tem que seguir a numeração do
  repositório, não a data do relógio.

### Dados: os globais sim, os de academia não

A única organização do projeto antigo é a **Tietê Fitness**, que é de testes e
já estava marcada para exclusão, e as 16 contas são 2 Super Admins, o time de
teste e 8 alunos `*.teste@email.com`. Levar isso para a produção nova seria
carregar lixo para dentro dela.

Então o que atravessou foi o que é da ArkeFit, e quase tudo veio das próprias
migrations de semeadura: **105 exercícios globais, 83 alimentos, 11 grupos
musculares, 10 equipamentos, 3 níveis de atacado, 5 preços B2B, 5 SLAs, os 6
documentos legais** (conferidos por `tipo + versão + sha256`, que é o que prova
qual texto foi aceito) e a configuração da plataforma.

Ficaram para trás de propósito: a organização de teste e seus modelos, o
histórico de webhooks do Asaas, a auditoria, os snapshots de MRR, as
reconciliações e os links de ativação. Nenhum arquivo de Storage foi copiado
porque só existiam 3 avatares, de contas de teste.

### Conferência

`scripts/migracao/comparar.mjs` compara os dois bancos objeto a objeto, não por
contagem — 232 regras de um lado e 232 do outro podem ser conjuntos diferentes.
Onde a definição importa, ela entra na comparação: o **md5 do corpo** de cada
função, o **md5 da condição** de cada regra de RLS.

Resultado em 22/09/2026, sem nenhuma divergência:

| | |
|---|---|
| tabelas | 88 |
| colunas (com tipo, nulidade e default) | 891 |
| funções / corpo das funções | 136 / 136 |
| regras de RLS (public + storage) | 237 |
| gatilhos | 60 |
| índices | 297 |
| restrições | 372 |
| enums | 34 |
| privilégios de tabela | 702 |
| EXECUTE em funções | 83 |
| buckets | 8 |
| rotinas do pg_cron | 12 |
| tabelas no realtime | 2 |

### O que não sai em migration, e por isso foi refeito à mão

- **Buckets** (8) e **regras de `storage.objects`** (5). São linhas e regras de
  tabela do Supabase, não schema nosso.
- **Rotinas do `pg_cron`** (12). `cron.job` pertence à extensão e não sai em
  dump. As três que chamam edge function traziam a URL do projeto escrita por
  extenso — recriá-las não era opcional: restauradas como estavam, apontariam
  para o projeto antigo. Conferido: **nenhuma rotina do projeto novo menciona o
  ref antigo.**
- **Tokens do Vault** (3). O Vault cifra com uma chave que é do projeto, então
  segredo copiado de outro projeto não decifra nunca mais. Nasceram novos.
- **Extensões.** Um projeto novo traz pgcrypto, uuid-ossp e o Vault, mas não
  `pg_cron` nem `pg_net`.

### Edge functions e `verify_jwt`

As 33 foram publicadas e o `verify_jwt` de cada uma bate com o da produção.

Isso passou a ser automático: até agora, quais funções respondem sem JWT vivia
só na flag `--no-verify-jwt` da linha de comando. Quem deployasse sem ela
fechava um endpoint público em silêncio — o webhook do Asaas pararia de receber
evento, a matrícula pública responderia 401 a todo aluno. As 13 estão
declaradas em `supabase/config.toml`, e o deploy reproduz o ajuste sozinho.

### Auth

Espelhado do projeto antigo: `site_url`, lista de URLs permitidas, senha mínima
de 8, exigência da senha atual para trocar, limite de e-mails e o SMTP do
Resend.

O item que engana é o **hook de envio de e-mail**. O Supabase só chama a edge
function `send-email` — a que manda o e-mail com a identidade visual do ARKE,
aquele que você validou no convite de primeiro acesso — se o hook estiver
ligado nas configurações de Auth. A assinatura de cada chamada é validada
contra um segredo que precisa ser **o mesmo** em dois lugares: na configuração
de Auth e no ambiente da função. Configurar um e esquecer o outro não dá erro
na hora; dá e-mail que não chega, dias depois, quando um aluno pedir a senha.
Por isso `scripts/migracao/auth-config.mjs` grava os dois na mesma execução, do
mesmo valor.

### Super Admins

As duas contas (`andre.alvesman@gmail.com` e `comercial@metodosarke.com.br`)
foram criadas no projeto novo com os papéis `superadmin` e `admin_arke`, lidos
da produção para não esquecer nem inventar ninguém.

Cada uma nasceu com e-mail confirmado e **senha aleatória que não foi impressa
nem guardada**. Você entra pelo "esqueci minha senha" do próprio app — que é o
caminho que só você controla. Isso só funciona depois da virada, quando o app
apontar para o projeto novo.

### Segredos

Gravados no projeto novo: `ASAAS_API_KEY` (a de produção, a mesma — não foi
gerada chave nova, que poderia invalidar a atual), `RESEND_API_KEY`,
`GEMINI_API_KEY`, `CRON_SECRET`, `VAPID_PRIVATE_KEY` e
`SEND_EMAIL_HOOK_SECRET`.

A chave **VAPID pública é derivada da privada** pela própria função
`vapid-public-key`, então só a privada precisa existir. Como ela é nova, quem
já tinha ativado notificação no celular precisa ativar de novo — com a base
atual, ninguém.

---

## A virada

Três passos. Nada depende de janela noturna: não há dado de cliente para
perder, e quem usa o sistema hoje é só você.

### 1. Os dois segredos que só você consegue buscar

A API do Supabase devolve o **SHA-256** dos segredos, nunca o valor — que é o
comportamento correto. Então estes dois não se copiam de um projeto para o
outro por aqui.

**`ASAAS_WEBHOOK_SECRET` — é rotação, não cópia.** É o token que se gera no
painel do Asaas, em Integrações → Webhooks, e **o Asaas não o mostra de novo
depois**. Como o valor atual está perdido dos dois lados, o caminho é gerar um
novo.

Gerar troca o token que o Asaas passa a enviar no cabeçalho
`asaas-access-token`, e a edge function recusa quem não bate. Por isso a ordem
importa: **gere o token junto com a mudança da URL do webhook**, no passo 3. Se
gerar antes, o Asaas continuará entregando na URL antiga com um token que o
projeto antigo não conhece, e todo evento passa a ser recusado até você
atualizar o secret de lá também. Fazendo os dois na mesma edição, só o projeto
novo precisa do valor.

Guarde o token no arquivo de chaves com o rótulo exato `ASAAS_WEBHOOK_SECRET`
numa linha e o valor na seguinte — é assim que `segredos.mjs` o encontra.

**`TURNSTILE_SECRET_KEY`** continua consultável no painel da Cloudflare
(Turnstile → widget do `arkefit.com.br`), então basta copiar. Sem ele o captcha
não é exigido — falha aberta, de propósito —, então isto não trava a virada,
só deixa a matrícula pública com uma camada a menos.

Com os dois no arquivo de chaves:

```powershell
cd C:\Users\andre\arke-system
$env:ARKE_CHAVES = 'C:\Users\andre\chaves.txt'
node scripts/migracao/segredos.mjs            # confere as fontes, não grava
node scripts/migracao/segredos.mjs --aplicar
```

O script é idempotente e não imprime valor nenhum. Se preferir na mão:

```powershell
npx supabase secrets set --project-ref lzyxqjibkfblrrjboylp 'ASAAS_WEBHOOK_SECRET=<valor>'
npx supabase secrets set --project-ref lzyxqjibkfblrrjboylp 'TURNSTILE_SECRET_KEY=<valor>'
```

### 2. Duas linhas no repositório

```
vercel.json           → trocar jbkrxrfdrmrkyldrrdpq por lzyxqjibkfblrrjboylp
supabase/config.toml  → project_id = "lzyxqjibkfblrrjboylp"
```

Foram deixadas apontando para o antigo de propósito: trocá-las antes do resto
quebraria o link de ativação da produção atual. As referências nos arquivos de
`supabase/migrations/` **não** se mexem — são registro do que foi aplicado.

### 3. Vercel, Asaas, e conferir

1. Na Vercel, em Production:
   - `VITE_SUPABASE_URL` = `https://lzyxqjibkfblrrjboylp.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_O6HzyGxNzQRvZHNgCk1MRQ_6jT5osSl`
   - Variável nova na Vercel só vale no **deploy seguinte**. Faça o deploy
     depois de salvar as duas.
2. No Asaas, na mesma edição do webhook: apontar a URL para
   `https://lzyxqjibkfblrrjboylp.supabase.co/functions/v1/asaas-webhook` **e**
   gerar o token novo (passo 1). Copiar o token antes de sair da tela — o Asaas
   não o mostra outra vez.
3. Entrar no app pelo "esqueci minha senha" e conferir a Visão Master.
4. Deixar o projeto antigo **pausado, não excluído**, por uma ou duas semanas.

### Depois da virada

- A conta de teste do E2E (`e2e-jornada@arkefit.com.br`) não existe no projeto
  novo, e sem ela `jornada-aluno.spec.ts` falha em todo deploy. Recriar pela
  matrícula pública de uma organização de homologação, com o acolhimento
  M.A.P.A.® concluído, e conferir se os secrets `E2E_EMAIL` e `E2E_SENHA` do
  GitHub seguem válidos.
- Criar a organização de homologação nova pela Visão Master → + Nova
  Organização. A Tietê não atravessou, o que já resolve a exclusão que estava
  pendente — e a conta E2E, que era o único motivo para adiá-la.

---

## Os scripts

Todos leem o token de acesso de `SUPABASE_ACCESS_TOKEN` ou do arquivo apontado
por `ARKE_CHAVES`, e **nenhum imprime valor de segredo**.

| script | o que faz |
|---|---|
| `01-antes-da-restauracao.sql` | zera o `public` do destino e cria as extensões |
| `replicar-schema.mjs` | replica as 161 migrations (`--conferir` não escreve nada) |
| `02-depois-da-restauracao.sql` | buckets, regras de storage, tokens do Vault e as 12 rotinas |
| `comparar.mjs` | compara os dois bancos objeto a objeto |
| `dados-globais.mjs` | compara a contagem das tabelas globais |
| `impressao-globais.mjs` | compara o conteúdo delas, linha a linha, por hash |
| `segredos.mjs` | grava os secrets das edge functions |
| `auth-config.mjs` | espelha o Auth e liga o hook de e-mail nos dois lugares |
| `superadmins.mjs` | cria os Super Admins com os papéis lidos da produção |
| `03-conferencia.sql` | conferência avulsa, para rodar em qualquer projeto |

Para refazer tudo do zero num projeto vazio, nesta ordem: `01` →
`replicar-schema --aplicar` → `02` → `segredos` → `auth-config` →
`superadmins` → `comparar`.
