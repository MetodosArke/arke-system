# ARKE® Gateway Local

Middleware Node.js/TypeScript que roda **dentro da rede local da
academia** (não na nuvem) e faz a ponte de baixa latência entre a catraca
física e a plataforma ArkeFit no Supabase.

```
Catraca física (TCP) ⇄ ARKE Gateway Local ⇄ Supabase Edge Functions
                              │
                        cache offline
                        (NeDB, em disco)
```

## Como funciona

1. O driver da catraca (`src/drivers/`) recebe a leitura de uma credencial
   (hoje só CPF é validado pela nuvem — outros tipos são capturados mas
   ainda negados com uma mensagem clara, ver limitações abaixo).
2. O `GatewayService` chama `POST /functions/v1/catraca-validar-acesso`
   com timeout estrito (`tempo_timeout_ms`, padrão 300ms).
3. Se a nuvem responde a tempo: libera/nega conforme a resposta, e o
   próprio Edge Function já grava o log em `acessos_catraca_logs`.
4. Se a nuvem falhar ou estourar o timeout (**contingência**): consulta o
   cache local (SQLite/NeDB) sincronizado periodicamente via
   `catraca-sincronizar-alunos`, decide liberar/negar por conta própria, e
   enfileira o acesso em `logs-pendentes.db` para sincronizar depois via
   `catraca-sincronizar-logs-offline` assim que a conexão voltar.
5. Um ícone na bandeja do sistema (Windows) mostra o status:
   🟢 online · 🟡 contingência (usando cache local) · 🔴 desconectado
   (sem nuvem e sem cache).

## Configuração

```bash
cp config.example.json config.json
```

Edite `config.json`:

| Campo | Descrição |
|---|---|
| `organization_id` | UUID da organização (informativo — a autenticação real é pelo token abaixo) |
| `token_api_local` | **O `device_token`** copiado da tela `/admin/catracas` no painel web (botão "Copiar") |
| `supabase_url` | URL do projeto Supabase (ex.: `https://SEU-PROJETO.supabase.co`) |
| `catraca_ip` / `catraca_porta` | Endereço da catraca na rede local |
| `modelo_catraca` | `controlid` \| `henry` \| `topdata` \| `dimep` \| `mock` |
| `tempo_timeout_ms` | Timeout da validação na nuvem antes de cair para o cache local (padrão `300`) |
| `sincronizar_alunos_intervalo_ms` | Intervalo entre sincronizações do cache local (padrão 5 min) |

## Uso

```bash
npm install
npm run dev          # roda em modo desenvolvimento (tsx, sem build)
npm run check         # type-check (src + tests)
npm run build          # compila para dist/
npm test               # testes unitários (vitest)
npm start               # roda dist/index.js (após build)
```

## ⚠️ Limitações conhecidas (leia antes de ir para produção)

1. **Protocolo das catracas físicas não está implementado.** Control iD,
   Henry, Topdata e Dimep usam protocolos binários proprietários — este
   pacote **não inventa/adivinha esses bytes**. `src/drivers/*Driver.ts`
   contém a conexão TCP genérica (funcional) mas os métodos de
   decodificação/comando lançam erro explícito até alguém preencher a
   lógica real a partir da documentação/SDK oficial de cada fabricante.
   Use `modelo_catraca: "mock"` (`src/drivers/MockDriver.ts`, totalmente
   funcional) para desenvolver e testar o resto do fluxo sem hardware.
2. **Só CPF é validado pela nuvem hoje.** A Edge Function
   `catraca-validar-acesso` recebe `{ device_token, cpf }`. Leituras de
   código de barras/RFID/biometria/QR Code são capturadas pelo driver
   (`LeituraCredencial.tipo`), mas ainda não têm um mapeamento para CPF no
   backend — o gateway nega essas leituras com uma mensagem clara em vez
   de fingir que valida.
3. **O instalador com assistente (`arkefit-gateway-setup.exe`) não foi
   compilado aqui.** `npm run build:exe` gera o binário standalone
   (`dist-exe/arkefit-gateway.exe`) via `@yao-pkg/pkg`, cross-compilando
   para Windows a partir de qualquer SO. Para o instalador de verdade,
   com assistente e atalho na inicialização, rode em uma máquina Windows
   com o [Inno Setup](https://jrsoftware.org/isinfo.php) instalado:
   ```powershell
   npm run build:exe
   iscc scripts\gateway-installer.iss
   ```
4. **A bandeja do sistema (`systray2`) exige um ambiente com GUI** —
   funciona no Windows/desktop Linux/macOS, mas é automaticamente
   desativada (com aviso no log, sem derrubar o serviço) em servidores/CI
   sem display, incluindo o ambiente onde este pacote foi desenvolvido.

## Testes

`npm test` cobre, com um driver mock e um cliente de nuvem fake (sem HTTP
real):

- Validação de acesso com **payload de sucesso** vindo da nuvem (liberado
  e negado).
- **Fallback offline**: nuvem indisponível/timeout → decide pelo cache
  local (libera aluno em dia, nega inadimplente, nega quando o cache
  também está vazio).
- Fila de logs offline: enfileirar, sincronizar com sucesso, e manter
  pendente se a sincronização falhar.
- Validação do `config.json` (schema Zod).
