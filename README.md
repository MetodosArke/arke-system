# Arke — Gestão de Treinos

Aplicativo web (PWA) para gestão de academia: treinos, dietas, evolução do aluno,
pontuação, desafios, feed e chat entre aluno, professor e administração.

## Tecnologias

- React 18 + TypeScript
- Vite 5
- Tailwind CSS + shadcn/ui
- TanStack Query
- Supabase (banco de dados, autenticação, storage e edge functions)

## Pré-requisitos

- Node.js 18 ou superior (recomendado 20+)
- npm (ou bun / pnpm)
- Um projeto Supabase próprio

## Configuração

1. Instale as dependências:

```sh
npm install
```

2. Crie o arquivo `.env` na raiz do projeto a partir do exemplo:

```sh
cp .env.example .env
```

3. Preencha o `.env` com os dados do seu projeto Supabase:

```
VITE_SUPABASE_URL="https://SEU_PROJECT_REF.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="SUA_CHAVE_ANON_AQUI"
VITE_SUPABASE_PROJECT_ID="SEU_PROJECT_REF"
```

> As chaves ficam em: painel do Supabase → Project Settings → API.

## Executando em desenvolvimento

```sh
npm run dev
```

A aplicação sobe em `http://localhost:8080`.

## Build de produção

```sh
npm run build
npm run preview
```

Os arquivos finais ficam na pasta `dist/`, prontos para hospedagem estática
(Nginx, Apache, Vercel, Netlify, S3 etc.). Como o app usa roteamento por hash,
não é necessária configuração especial de rewrite no servidor.

## Testes

```sh
npm run test
```

## Backend (Supabase)

A pasta `supabase/` contém:

- `migrations/` — todo o schema do banco (tabelas, funções, políticas RLS, cron).
- `functions/` — edge functions (criação/edição/remoção de usuários,
  notificações, push notifications e chave pública VAPID).
- `config.toml` — informe aqui o `project_id` do seu projeto Supabase.

Para aplicar no seu projeto, usando a CLI oficial do Supabase:

```sh
supabase link --project-ref SEU_PROJECT_REF
supabase db push
supabase functions deploy
```

### Segredos necessários nas edge functions

Configure em Project Settings → Edge Functions → Secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VAPID_PRIVATE_KEY` (para push notifications)

### Buckets de storage esperados

`avatars`, `chat-videos`, `dietas`, `email-assets`, `exercicio-imagens`,
`exercicio-videos`, `feed-images` — todos públicos.

## Perfis de acesso

- **Aluno** — treinos, dieta, evolução, pontuação, desafios, feed e chat.
- **Professor** — acompanhamento e execução de treinos dos alunos.
- **Admin** — gestão completa de alunos, treinos, dietas, exercícios e conteúdo.
- **Super Admin** — gestão de usuários e permissões.

Os papéis ficam na tabela `user_roles` e são validados por RLS através da
função `has_role()`.

## Estrutura do projeto

```
src/
  components/    componentes de UI, layout e módulos por perfil
  contexts/      autenticação, tema e estado de navegação
  hooks/         hooks de dados e regras de negócio
  integrations/  cliente Supabase e tipos gerados do banco
  lib/           utilitários
  pages/         telas por perfil (app, admin, professor, auth)
supabase/        migrations e edge functions
public/          ícones, manifest do PWA e service worker
```

## Licença

Uso privado.
