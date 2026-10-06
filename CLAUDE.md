# ARKE — Diretrizes de Desenvolvimento e Contexto do Projeto

Este arquivo entra inteiro em toda sessão: tem só as **regras vigentes**, o **mapa** e os **comandos de prova**. O porquê de cada regra, o defeito que a originou e o "Conferido" de cada entrega estão em [`docs/registro/`](docs/registro/README.md), um arquivo por assunto. `packages/gateway/` e `supabase/functions/` têm o próprio CLAUDE.md, que vale ao trabalhar nelas.

## O que é

O ArkeFit (ARKE) é uma plataforma SaaS para academias, studios e profissionais autônomos. Junta o software de acompanhamento a uma metodologia de atendimento, treino e nutrição: M.A.P.A.® → B.A.S.E.® → R.O.T.A.® → A.P.E.X.® → L.E.G.A.D.O.®. O objetivo é reduzir a evasão evitável e aumentar a receita da academia.

- **Plano Free:** todo aluno matriculado e em dia com a academia. Inclui treinos com snapshot imutável, calendário, rotina, água, dieta da nutricionista da academia e chat com a equipe da academia.
- **Método ARKE (Integrado e Elite):** pago à parte, e soma o que é da metodologia. Inclui acolhimento, fases da jornada, mentor e nutricionista da ArkeFit, check-ins e relatórios. Quando o aluno compra o Método, treino, dieta, anamnese, metas e jornada passam a ser do **mentor da ArkeFit**. A academia fica com cadastro, biometria, mensalidade, situação, atestado e PAR-Q, e vê o treino mas não a dieta nem a anamnese.
- **O plano é calculado, não gravado:** `plano_do_aluno()` no banco, `planoDoAluno()` em `src/lib/planoAluno.ts`.
- **Stack:** React + TypeScript (Vite, Tailwind, shadcn/ui, Lucide), Supabase (Auth, Postgres com RLS, Storage, Edge Functions), Vercel. O banco é `lzyxqjibkfblrrjboylp`, em São Paulo (`sa-east-1`) e no fuso de Brasília.
- **Endereços:** app em `app.arkefit.com.br`; página de vendas na raiz de `arkefit.com.br`.
- **Infraestrutura:** serviços, domínios, DNS e o nome de cada segredo (sem valor) estão em `docs/INFRAESTRUTURA.md`, atualizado no mesmo PR de qualquer troca. **O repositório é público:** nada de segredo, login, caminho de máquina ou plano financeiro.

## Princípios

1. **Multitenancy primeiro.** Toda tabela tem `organization_id` e RLS desde o primeiro script. Tabela da plataforma sem organização, como `plataforma_config` ou `equipe_arkefit`, é exceção declarada.
2. **Construção em camadas.** Hardware e agregadores só entram depois de Auth, RLS e Método validados.
3. **Sem dado inventado em produção.** A tela mostra dado real ou um estado vazio claro.
4. **Ciclo completo de atendimento.** Pendência só fecha com desfecho registrado: motivo → responsável → prazo → ação → desfecho → próxima checagem.

**App do aluno.** A home mostra uma única **Próxima Ação**, decidida por `definirProximaAcao()` (`src/lib/proximaAcao.ts`), e depois o progresso semanal, o próximo evento e a ajuda. "Em dia" é desfecho legítimo. Algumas regras de produto:
- Pergunta construtiva: "Como está sendo seguir seu plano?".
- Dor, pedido de ajuda e falta justificada não tiram ponto.
- Ranking corporal só na evolução privada do aluno.
- Constância é medida contra a meta do próprio aluno.

## Decisões vigentes

- **Planos B2B:** todo plano tem o sistema inteiro; muda o limite de alunos ativos e o suporte.
  - Preço e limite moram em `planos_b2b_precos`, e a página de vendas lê `planos_b2b_site()`: mudar o preço em Configurações muda o site junto.
  - O limite acompanha o plano (`trg_limite_segue_plano`).
  - Unidade de rede, e quem a ArkeFit não cobra, tem `valor_mensal_b2b = 0`.
  - O Método fica fora do site até ter preço fixo.
- **Repasse do Método:** negociado por academia em `organizations.repasse_*`, com exceção por nível em `organization_planos_precificacao.repasse_*`.
  - Academia sem repasse negociado **não cobra o Método** (422). A tabela de atacado é só referência.
  - A taxa do gateway é somada por cima: `arke_taxa_processamento()`, com mínimo de R$ 1,99 por cobrança.
  - A academia recebe valor fixo no split (`fixedValue`), e o repasse fica travado na assinatura (`valor_repasse_arke`).
  - A conta mora em três lugares, que mudam juntos: `repasse_arke()`, `src/lib/repasse.ts` e `asaas-create-subscription`.
- **Asaas configurado e funcionando:** não tratar como pendência nem perguntar. Organização em `trial` usa o sandbox (`ambienteAsaas`), e só o Super Admin dá trial. A carteira de split da academia nunca é a da ArkeFit.
- **Trial é homologação, nunca oferta.** Matrícula e plano B2B valem desde o primeiro dia e vencem no dia.
- **Bloqueio por pagamento.** É dívida só a cobrança emitida e vencida sem confirmação (lista de inclusão: `pendente`, `atrasado`).
  - B2B: bloqueia só a equipe, com 7 dias de tolerância.
  - Aluno inadimplente: 5 dias de tolerância. O pausado sai na hora. A catraca segue `situacao_permite_app()`.
  - A ArkeFit nunca é bloqueada.
- **CPF obrigatório em toda matrícula** (gatilho em `alunos`). A equipe não precisa de CPF.
- **Aluno menor de idade:** data de nascimento obrigatória na matrícula (na importação, sem ela a idade fica desconhecida). Para o menor, saúde, biometria e IA só liberam com o aceite do responsável pelo link do e-mail, um por propósito; sem a data, ficam travadas até ela ser informada. A trava é por gatilho (`exigir_liberacao_consentimento`), e o aceite libera o aluno a consentir, não consente por ele.
- **A responsabilidade fiscal segue o split:** a nota da academia sai no CNPJ dela, pelo líquido dela.
- **Resultado não é promessa:** no site, número de mercado só com fonte citada; número próprio só "observado", com período e método.
- **WhatsApp fica fora do produto.** O aviso sai por push e e-mail.
- **Avanço de fases automático** (`avancar_fase_automatico`, um passo por vez, nunca para trás). A passagem manual vale por cima.
- **Mentor Centralizado:** a fila do mentor é a mesma `tarefas`, com `dono`. Cobrança e atestado ficam com a academia. A separação mora no RLS.
- **Agentes:**
  - Letícia (comercial) e Bruno (implantação) rodam em rotina, com interruptor em `plataforma_config`, e assinam como equipe, nunca como pessoa.
  - Lucas (o assistente) responde na Central de Ajuda.
  - O Vigia cuida da saúde técnica e não lê dado de aluno.
  - O Sentinela está congelado, salvo correção aprovada.
- **IA:** a IA com dado de aluno roda no Amazon Bedrock em São Paulo, com o Claude 3 Haiku e a região fixa no código. As únicas exceções fora do país são o Vigia e o assistente, com entrada sem identificação. O consentimento é por propósito e versionado.
- **Perfil simulado:** só a ArkeFit simula, com as duas etapas. Na sessão simulada, só a própria pessoa autoriza IA, biometria, documentos e contrato.
- **Duas etapas:**
  - as contas da ArkeFit sempre;
  - a gestão, em exportar todos os dados, avisar o encerramento, trocar o e-mail de login de alguém e trocar a carteira de recebimento (que fica na auditoria e avisa a ArkeFit por e-mail);
  - para a gestão, opcional na entrada do painel.
- **Biometria:** só o titular consente, pelo app ou pelo termo impresso que a recepção anexa. Revogar, excluir, anonimizar ou encerrar a matrícula apaga a biometria dos equipamentos; o número de digital ou rosto vinculado à mão também exige a autorização.
- **Display de catraca é público:** "Bem-vindo!" ou "Aluno", nunca o nome, e a negativa não fala de dinheiro. Código de barras e QR na catraca não identificam aluno (`catracaPublica.guarda`).

## Regras que já custaram caro

Cada linha é uma armadilha que já aconteceu aqui. Onde há trava, ela é um teste-guarda em `src/lib/*.guarda.test.ts`, que falha se a armadilha voltar.

**Banco**
- RLS: **uma regra por tabela e operação** (leitura, inclusão, alteração, exclusão). Uma segunda regra permissiva soma por OU e anula a primeira. `alter policy … using` muda só a metade `using`, não o `with check`.
- Função `security definer` que recebe id de aluno ou de academia **confere quem chama**, ou nasce sem EXECUTE para `authenticated`.
- Função de gatilho nasce com EXECUTE para o PUBLIC. Revogue depois de cada rodada que criar uma; o bloco idempotente está em `20261215010000`.
- UPDATE que o RLS descarta responde **200 com zero linhas**. Escrita do aluno em tabela onde ele só lê vai por RPC `security definer`, e o PATCH confere as linhas alteradas.
- `ON CONFLICT` sobre índice parcial **repete o predicado**; sem isso, falha só em execução.
- plpgsql só acusa erro de tipo em execução, então função nova roda em transação desfeita antes de entrar.
- `current_date` já é a data de Brasília, pelo fuso do banco. O `pg_cron` agenda em GMT.
- **Migration:**
  - segue a numeração do repositório, não a data do relógio;
  - começa com `set lock_timeout = '5s'` (`migrations.guarda`);
  - coluna que a tela publicada ainda lê sai em migration pós-deploy;
  - documento legal entra no banco só depois de o texto estar no ar.
- Os gatilhos `before insert` de `tarefas` disparam em ordem alfabética, e o do SLA é o último (`trg_ultimo_`, `ordemGatilhosTarefas.guarda`).
- Tabela com `bigserial` precisa de `grant usage` na sequência para a `service_role`.
- `plataforma_config` tem faixa por chave (`faixa_plataforma_config()`). Chave nova nasce com faixa.
- O status de cobrança só anda pelas transições permitidas (`trg_transicao_cobranca`): o pago não volta a dever.
- Gatilho do dinheiro que entrou (receita, nota fiscal) é `after insert or update`: a cobrança pode nascer confirmada (`cobrancaQueNascePaga.guarda`).
- CPF fica só com os dígitos (`trg_cpf_sem_mascara`) e se compara sem máscara (`cpfSemMascara.guarda`).
- Exclusão de tenant por fora do produto com `session_replication_role = 'replica'` deixa órfãos. Confira com `verificar_orfaos()`.

**App**
- **Datas:** use `dataBrasilia`, `hojeBrasilia` e `formatarDataBR` (`src/lib/dataBrasilia.ts`), nunca `toISOString().slice(0, 10)` nem `new Date("aaaa-mm-dd")` na tela (`dataBrasilia.guarda`).
- **Erro de edge function:** use `mensagemDeErroEdge()`. Em erro, o `data` vem nulo (`erroEdge.guarda`).
- **Mil linhas:** a API corta sem avisar. Use `todasAsLinhas`, e ids em lotes de 200 com `porLotes` (`paginar.guarda`).
- **Cache:** a mesma chave do react-query nunca serve a duas consultas diferentes (`chavesDeCache.guarda`).
- **Formulário:** mutação que envia estado de formulário recebe os dados no `mutate`, não pelo fechamento.
- **Efeitos:** valor padrão literal (`= []`, `= {}`) em dado que é dependência de efeito causa laço.
- **Números na tela:** `reais()` e `decimal()`, nunca `toFixed` (`numeros.guarda`).
- **Colunas:** as colunas de cada consulta são conferidas com `types.ts`, que é **gerado** (`supabase gen types`) (`colunasConsultas.guarda`).
- **Vínculo:** use `escolherVinculo()`. Nunca use `.maybeSingle()` em `organization_members` filtrando só por `user_id`, porque quem está em duas academias quebra.
- **Sessão:** evento de sessão da mesma pessoa não recarrega o `AuthContext`; recarregar desmontava o painel inteiro.
- **Rascunho:** digitação cara vai em `useRascunho`, no `sessionStorage`, e nunca restaura sozinha.
- **Imagem:** sai reduzida do aparelho antes do upload (`reduzirImagem.guarda`). Arquivo de nome único ganha cache de 1 ano.
- **Sorteio:** nunca `Math.random()` (`aleatorio.guarda`).

**Segurança e privacidade**
- Papel da ArkeFit só vale com as duas etapas: `has_role` no banco e `verificada(claims)` nas funções (`verificacao.guarda`). Na gestão, `sessao_verificada()`.
- O token do Gateway só como hash (`tokenCatraca.guarda`). O receptor atende só os IPs dos equipamentos do config.
- IA: região fixa e modelo sem roteamento (`iaNoBrasil.guarda`), e prazo em toda chamada (`prazoIA.guarda`).
- Sentry: o módulo é uma lista do que não sai. Session Replay desligado, e a identificação vai só por UUID.
- Captcha só por `_shared/captcha.ts`. Senha vazada por k-anonimato (HIBP), com falha aberta.
- A chave do Asaas só pelo `ambienteAsaas` (`ambienteAsaas.guarda`). O webhook confere cada gravação, e o aviso do sandbox só toca organização em trial, mesmo sem achar organização (`webhookAsaas.guarda`).
- Na sessão simulada, as autorizações da pessoa são recusadas no banco (`perfilSimulado.guarda`).

## Mapa

- `src/lib/`: regras puras, com teste ao lado. Por exemplo `repasse.ts`, `planoAluno.ts`, `proximaAcao.ts`, `dataBrasilia.ts` e `paginar.ts`.
- `src/pages/`: `admin/` (painel da academia), `app/` (aluno), `superadmin/` (Visão Master) e `public/` (vendas, matrícula, primeiro acesso).
- `src/components/`, `src/contexts/AuthContext.tsx` (sessão, vínculo, plano do aluno) e `src/integrations/supabase/types.ts` (gerado).
- `src/content/ajuda/*.md` e `src/lib/ajuda/catalogo.ts`: a Central de Ajuda. Tela mudou, artigo muda no mesmo PR.
- `src/content/legal/*.md`: o texto dos documentos legais. O banco guarda versão e hash, e `documentosLegais.test.ts` falha se o texto mudar sem o hash.
- `supabase/migrations/` e `supabase/functions/`, com `_shared/` e o próprio CLAUDE.md. O `verify_jwt` de cada função fica em `supabase/config.toml`.
- `supabase/historico/`: o retrato fiel de como o banco de produção foi construído (a ordem e o texto que rodou), para recriá-lo do zero pelo repositório. Renovar com `scripts/migracao/historico.mjs`; `historicoBanco.guarda` confere.
- `packages/gateway/`: o Gateway Local das catracas, com o próprio CLAUDE.md. `packages/ponte-topdata/`: a ponte .NET da Topdata (`docs/PONTE_TOPDATA.md`).
- `scripts/`: sandbox do Asaas, prontidão (`scripts/prontidao/`), marca, Central de Ajuda e migração.
- `docs/`:
  - `registro/` (o diário, por assunto);
  - `INFRAESTRUTURA.md`;
  - `LANCAMENTO_1_0.md`;
  - `RESTAURACAO_BACKUP.md`;
  - `DECISOES_PENDENTES.md`;
  - os manuais antigos, que a Central de Ajuda substituiu.
- `e2e/`: Playwright contra produção, depois de cada deploy: fumaça, a jornada do aluno e o painel do gestor. As contas `e2e-jornada@` e `e2e-gestor@arkefit.com.br` e a academia "ARKE Homologação — testes automáticos" (`homologacao`) são permanentes: **não excluir**. Recriar: `node scripts/migracao/conta-e2e.mjs --criar-organizacao --aplicar --rodar-e2e`.

## Comandos de prova

- `npm run check`: tipos, lint, o `deno check` das funções e a auditoria das dependências de produção (alto e crítico); só erro reprova. `npx vitest run`: os testes do app, guardas incluídas.
- Gateway: `cd packages/gateway && npm test && npm run check`. Versão nova muda `src/versao.ts` e o `package.json` juntos.
- Sandbox do Asaas, que só aceita chave `$aact_hmlg_`: `npm run sandbox:cartao|ciclo|avulsa|conta|nfse|reconciliacao|implantacao|b2b-valor|assinatura`.
- Emuladores das catracas: `cd packages/gateway && npm run emular:controlid|toletus|litenet3|facial-topdata|intelbras`.
- Artigo da Central mudou: `npm run ajuda:indice`, e depois publicar `assistente-academia`.
- Vigia: `npm run simulado:vigia`.
- Academia de demonstração (Ponto Alto Academia, fictícia): `npm run demo:recriar` na véspera de uma apresentação; os logins e a senha ficam fora do repositório, em `~/arkefit-demonstracao.txt`.
- IAs (menos o Sentinela): `npm run avaliar:ia` (com `-- --vigia`). Roteiro ou modelo mudou, avalia de novo: `avaliacaoIA.guarda.test.ts` cobra.
- **Como provar uma entrega**, em camadas:
  1. o banco, em transação desfeita;
  2. a corrente real, pelas funções publicadas, com contas e academia temporárias apagadas no fim;
  3. a tela, no computador e no celular;
  4. um defeito plantado de propósito, para ver o teste falhar.

  Deploy de edge function não é prova: `npm run check` (que roda o `deno check` das funções) e uma chamada autenticada de verdade.

## Como registrar

Cada entrega vai numa seção em `docs/registro/<assunto>.md`, no mesmo PR. A seção traz a data, o porquê de cada decisão, o defeito que apareceu no caminho e a linha "Conferido" com números. Este arquivo só muda quando muda uma regra, o mapa ou um comando. Decisão que substitui outra diz "Superado em <data>" no texto antigo.
