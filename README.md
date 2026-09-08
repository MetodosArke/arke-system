# Sistema Arke

Plataforma SaaS multi-tenant para academias, studios, profissionais, nutricionistas e alunos. O projeto inclui subsistemas separados por perfil, administração de clientes e permissões, branding por organização, agenda, financeiro, auditoria, PWA e demonstrações de integrações externas.

## Tecnologias

- React 19, TypeScript, Vite e Tailwind CSS
- Express e tRPC
- Drizzle ORM
- Vitest
- Supabase como banco operacional complementar

## Execução local

```bash
pnpm install
pnpm dev
```

Para validar a aplicação:

```bash
pnpm test
pnpm check
pnpm build
```

## Configuração do Supabase

O instalador completo está em [`supabase/Arke-Supabase-Setup.sql`](supabase/Arke-Supabase-Setup.sql). Execute o arquivo **uma única vez** no SQL Editor de um projeto Supabase novo e vazio.

O SQL cria tabelas, índices, funções, triggers, políticas RLS, permissões e buckets de Storage. Credenciais, URLs privadas, tarefas `pg_cron` e chamadas de Edge Functions não fazem parte do arquivo.

## Segurança

Variáveis de ambiente e chaves de serviços externos não são versionadas. Configure os secrets diretamente no ambiente de hospedagem. As integrações de apresentação permanecem em modo de teste até que credenciais de produção sejam fornecidas.
