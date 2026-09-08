# Arke SaaS — acompanhamento

## Concluído

- Preservada a identidade visual original do anexo: logo, tipografia Montserrat/Cormorant Garamond, dourado, preto e neutros quentes.
- Adicionados manifest PWA, ícones derivados da logo original, cache offline leve, notificações push e suporte de instalação para Aluno e Profissionais.
- Criado o endpoint `POST /api/v1/access/check-in` com contrato compatível com adaptadores Topdata, Madis, Henry e Control iD, funcionando em modo demonstração.
- Adicionado calendário visual interativo ao módulo de agenda.
- Mantida a separação de módulos, permissões por perfil, painel Super Admin, SaaS, branding e dashboards do piloto.
- Validado com 18 testes Vitest, TypeScript sem erros, build de produção aprovado e chamadas HTTP de check-in permitidas/negadas verificadas.

## Pendências para produção real

- Configurar `CATRACA_API_KEY` por organização/unidade e implementar adaptadores específicos do fornecedor escolhido.
- Conectar persistência do endpoint de check-in às tabelas de presença e auditoria do banco de produção.
- Configurar Supabase/Resend/Asaas somente no ambiente seguro de deployment, usando secrets gerenciados; nenhuma chave foi gravada no código.
- Separar bundles PWA por módulo caso a distribuição exija aplicativos instaláveis independentes.
