# Manual do ARKE® Gateway Local

> Pacote: `packages/gateway` · Executa **dentro da rede local da academia** (não na nuvem)
> Público-alvo: equipe técnica/suporte responsável por instalar e manter o middleware que conecta a catraca física ao ArkeFit.

## Sumário

1. [O que é e como funciona](#1-o-que-é-e-como-funciona)
2. [Instalação](#2-instalação)
3. [Configuração](#3-configuração)
4. [Contingência Offline](#4-contingência-offline)
5. [Diagnóstico e suporte](#5-diagnóstico-e-suporte)
6. [Limitações conhecidas](#6-limitações-conhecidas)

---

## 1. O que é e como funciona

O ARKE Gateway Local é um middleware Node.js/TypeScript que roda num computador **dentro da rede local da academia** (nunca na nuvem) e faz a ponte de baixa latência entre a catraca física e a plataforma ArkeFit no Supabase:

```
Catraca física (TCP) ⇄ ARKE Gateway Local ⇄ Supabase Edge Functions
                              │
                        cache offline
                        (NeDB, em disco)
```

Fluxo de uma leitura de credencial:

1. O driver da catraca (`src/drivers/`) recebe a leitura (hoje só CPF é validado pela nuvem — outros tipos de credencial são capturados mas ainda negados com mensagem clara).
2. O `GatewayService` chama `POST /functions/v1/catraca-validar-acesso` com timeout estrito (`tempo_timeout_ms`, padrão 300ms).
3. Se a nuvem responde a tempo: libera/nega conforme a resposta — o próprio Edge Function já grava o log em `acessos_catraca_logs`.
4. Se a nuvem falhar ou estourar o timeout (**modo contingência**): o Gateway consulta o cache local e decide liberar/negar por conta própria — ver [Contingência Offline](#4-contingência-offline).
5. Um ícone na bandeja do sistema (Windows) mostra o status: 🟢 online · 🟡 contingência (usando cache local) · 🔴 desconectado (sem nuvem e sem cache).

## 2. Instalação

### 2.1 Pelo instalador com assistente (recomendado)

1. Execute **`arkefit-gateway-setup.exe`** no computador Windows conectado à catraca.
2. O assistente instala o binário em **`%ProgramFiles%\ArkeFit Gateway`**, junto com um `config.example.json` (só na primeira instalação — não sobrescreve um `config.json` já existente).
3. São criados dois atalhos: um no Menu Iniciar e um em **inicialização do Windows** (`userstartup`) — assim o Gateway sobe sozinho como serviço de bandeja toda vez que o computador liga.
4. Ao final, o assistente já pergunta se você quer iniciar o Gateway imediatamente.

### 2.2 Build manual (para quem gera o instalador)

O `arkefit-gateway-setup.exe` é compilado a partir do código-fonte (`packages/gateway`) com:

```powershell
npm run build:exe        # gera dist-exe/arkefit-gateway.exe (via @yao-pkg/pkg, cross-compile p/ Windows)
iscc scripts\gateway-installer.iss   # exige Inno Setup, só compila em Windows
```

### 2.3 Rodando sem instalar (desenvolvimento/homologação)

```bash
cd packages/gateway
npm install
cp config.example.json config.json   # depois edite — ver seção 3
npm run dev                           # modo desenvolvimento (tsx, sem build)
```

Para testar o fluxo completo sem hardware físico, use `"modelo_catraca": "mock"` no `config.json` — o `MockDriver` é totalmente funcional e simula leituras de CPF.

## 3. Configuração

Todos os parâmetros vivem em `config.json`, na mesma pasta do executável (`%ProgramFiles%\ArkeFit Gateway\config.json` numa instalação padrão):

| Campo | Descrição |
|---|---|
| `organization_id` | UUID da organização (informativo — a autenticação real é pelo `token_api_local`) |
| `token_api_local` | **O `device_token`** copiado da tela `/admin/catracas` no painel web (botão "Copiar" ao lado do dispositivo cadastrado) |
| `supabase_url` | URL do projeto Supabase (ex.: `https://SEU-PROJETO.supabase.co`) |
| `catraca_ip` / `catraca_porta` | Endereço IP e porta da catraca física na rede local |
| `modelo_catraca` | `controlid` \| `henry` \| `topdata` \| `dimep` \| `mock` |
| `tempo_timeout_ms` | Timeout da validação na nuvem antes de cair para o cache local (padrão `300`) |
| `sincronizar_alunos_intervalo_ms` | Intervalo entre sincronizações do cache local de alunos (padrão `300000` = 5 min) |

> **Onde conseguir o `token_api_local`**: no painel web, gestor ou admin_arke acessa `/admin/catracas`, cadastra (ou já tem cadastrado) o dispositivo, e clica em "Copiar" ao lado dele. Se o token precisar ser trocado (vazamento, troca de equipamento), um SuperAdmin pode resetá-lo em `/superadmin` (ação "Resetar Token do Gateway Local") — isso invalida o token antigo imediatamente, exigindo atualizar o `config.json` local com o novo valor.

Depois de editar `config.json`, reinicie o Gateway (ou reinicie o computador, já que ele sobe automaticamente).

## 4. Contingência Offline

O Gateway nunca deixa a catraca "cega" mesmo sem internet — dois mecanismos de cache local em disco, usando **NeDB** (banco de arquivo único, sem servidor):

### 4.1 Cache de alunos (`alunos-cache.db`)

- Populado periodicamente (a cada `sincronizar_alunos_intervalo_ms`, padrão 5 min) chamando a Edge Function **`catraca-sincronizar-alunos`**, autenticada pelo mesmo `token_api_local` da catraca.
- Cada sincronização **substitui** o cache inteiro pela lista atual de alunos ativos da organização (não é incremental) — garante que o cache nunca fique com aluno cancelado/inadimplente desatualizado por muito tempo.
- Quando a nuvem está fora do ar (timeout ou erro), o Gateway consulta esse cache local por CPF para decidir liberar (aluno em dia) ou negar (inadimplente/não encontrado) — sem depender da internet.

### 4.2 Fila de logs pendentes (`logs-pendentes.db`)

- Toda liberação/negação decidida **em modo contingência** (sem conseguir falar com a nuvem no momento) é enfileirada aqui, com `sincronizado: false`.
- Assim que a conexão com a nuvem volta, o Gateway envia os logs pendentes **em lote** para a Edge Function **`catraca-sincronizar-logs-offline`**, que os insere em `acessos_catraca_logs` — nenhum acesso registrado offline é perdido.
- Depois do envio confirmado, os registros são marcados `sincronizado: true` (e podem ser limpos periodicamente).

### 4.3 Estados da bandeja do sistema

| Ícone | Estado | Significado |
|---|---|---|
| 🟢 | Online | Nuvem respondendo dentro do timeout — validação em tempo real |
| 🟡 | Contingência | Nuvem indisponível/lenta — decidindo pelo cache local, enfileirando logs |
| 🔴 | Desconectado | Sem nuvem **e** sem cache local utilizável — catraca não consegue validar |

## 5. Diagnóstico e suporte

O Gateway expõe um servidor HTTP local de diagnóstico (Fastify, porta **4570**, **só em `127.0.0.1`** — nunca exposto fora da máquina):

- `GET http://127.0.0.1:4570/health` → `{ ok: true }` (confirma que o processo está de pé).
- `GET http://127.0.0.1:4570/status` → status atual do `GatewayService` (online/contingência/desconectado) e o timestamp da última verificação.

Use esses endpoints para automação de monitoramento local ou para um técnico confirmar rapidamente o estado do Gateway sem precisar ler os logs.

## 6. Limitações conhecidas

Leia antes de colocar em produção:

1. **Protocolo das catracas físicas ainda não está implementado.** Control iD, Henry, Topdata e Dimep usam protocolos binários proprietários — os drivers em `src/drivers/*Driver.ts` têm a conexão TCP genérica funcional, mas os métodos de decodificação/comando lançam erro explícito até serem preenchidos com a lógica real de cada fabricante. Use `modelo_catraca: "mock"` para desenvolver/homologar sem hardware.
2. **Só CPF é validado pela nuvem hoje.** A Edge Function `catraca-validar-acesso` recebe `{ device_token, cpf }`. Leituras de código de barras/RFID/biometria/QR Code são capturadas pelo driver mas ainda não têm mapeamento para CPF no backend — o Gateway nega essas leituras com mensagem clara em vez de fingir validação.
3. **A bandeja do sistema exige um ambiente com GUI** (Windows/desktop Linux/macOS) — em servidores/CI sem display, ela é desativada automaticamente (com aviso no log), sem derrubar o serviço.
