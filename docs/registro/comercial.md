# Comercial

Planos, atacado, o que a página de vendas promete e os ajustes comerciais no app.

## Estrutura Comercial & Modelo de Atacado (Wholesale)

### 1. Planos B2B (Assinatura de Plataforma para Academias)
Valor mensal fixo pago pela academia para acesso à infraestrutura, isolamento por tenant, aplicativo com marca da academia e painel "Minha Fila" para a equipe local.

**Todo plano tem o sistema inteiro** (decisão do responsável, 28/09/2026). O que muda de um plano para outro é o limite de alunos ativos e o suporte; nenhum recurso é travado por plano. A descrição antiga prometia diferenças de recurso que o sistema nunca travou, e foi ajustada a isto.

Tabela vigente desde 01/10/2026 (decisão do responsável, depois da comparação com os concorrentes), com o teto do Growth de 06/10/2026:

- **Growth (uma unidade, até 500 alunos ativos):** R$ 390,00/mês — suporte pelo canal de atendimento.
- **Enterprise (uma unidade, a partir de 501 alunos):** R$ 790,00/mês, sem teto — suporte prioritário.

**O teto do Growth subiu de 300 para 500 alunos** (decisão do responsável, 06/10/2026: "o plano de entrada passa a ter teto de até 500 alunos, e os outros acompanham"). O preço não muda. O Enterprise passa a começar em 501, porque começa onde o Growth termina; o Redes e o Custom não têm teto de alunos. As academias que estavam no Growth com o teto de antes (300) subiram junto; limite negociado à parte não é tocado (`20261384010000`). O Contrato da Academia ganhou a versão 2026-10-06 com a tabela nova, e a lista de planos da nova academia na Visão Master passou a ler o teto da tabela, como o site, em vez de trazê-lo escrito. A frase anterior, "Growth até 300 alunos, Enterprise a partir de 301", foi **superada em 06/10/2026**.

**Conferido** (06/10/2026):
- **No banco de produção, em transação desfeita:**
  - a tabela e o limite padrão do Growth passaram a 500;
  - a homologação e a Ponto Alto foram de 300 para 500, e o autônomo ficou em 150;
  - uma academia nova no Growth nasce com 500, e ao passar para o Enterprise fica sem teto;
  - `planos_b2b_site()` já devolve 500.
- **`documentosLegais`:** o hash novo bate. Defeito plantado (o texto do contrato mudado sem o hash): o teste falhou.
- **Redes (até 3 unidades):** R$ 1.290,00/mês, cobrado na unidade principal — suporte prioritário e SLAs dedicados.
- **Custom (redes com mais de 3 unidades):** sob consulta — personalização avançada de branding, suporte presencial dedicado e integrações sob demanda.
- **Taxa de implantação:** R$ 500,00 de referência, negociável por contrato.

O Starter (R$ 390 até 150 alunos) saiu de venda: o salto de 151 para 500 alunos custava o dobro e deixava a faixa onde está a maior parte das academias de bairro acima da Tecnofit. O valor do enum fica, para quem ainda estiver nele.

> Implementação: `organizations.plano_b2b` (enum) guarda o plano, e `planos_b2b_precos` o preço e o limite de cada um (`20261305010000_tabela_b2b_outubro.sql`). **O limite acompanha o plano**: `trg_limite_segue_plano` grava o limite da tabela na criação e quando o plano muda sem o limite mudar junto. Antes, trocar o plano deixava o limite antigo, e a academia que subia de plano seguia barrada no teto do anterior. Limite nulo é sem teto (`exigir_limite_alunos` já tratava assim). **Unidade de rede** é organização no Redes com `valor_mensal_b2b = 0`: `asaas-assinatura-b2b` não cria assinatura para ela e a ficha mostra "Unidade de rede". Zero também é o valor de quem a ArkeFit decide não cobrar, como o painel de personal de um sócio (03/10/2026): fora do Redes a ficha mostra "Sem mensalidade", e a conclusão da configuração não promete fatura. O teto de 3 unidades do Redes é regra comercial, não trava do sistema.

**A tabela está na página de vendas** (decisão do responsável, 02/10/2026): preço aberto quebra a objeção antes do contato, e a academia já compara com o que paga hoje. A seção *Planos* da página lê `planos_b2b_site()` (`20261308010000_planos_no_site.sql`), que devolve, sem login, preço e limite dos quatro planos à venda e a taxa de implantação de referência. Lê a mesma tabela da cobrança, então **mudar o preço em Configurações muda o site junto**; preço escrito na página divergiria na primeira mudança. As frases de cada cartão saem de `src/lib/planosSite.ts`: o Enterprise começa onde o Growth termina e, sem limite, diz "sem limite". O Enterprise não tem teto: o de 1.500 alunos, posto à mão, saiu no mesmo dia, porque uma unidade só dificilmente passa disso e um teto ali só barraria quem cresce. **O Método ARKE fica fora do site** até o preço fixo dele, igual para todas as academias, ser definido (decisão do mesmo dia, que vai substituir o repasse negociado por academia); a página diz só que ele é opcional e contratado à parte.

### 2. Licenças de Atacado (Wholesale) vs. Sugestão de Varejo (por aluno/mês)
A academia compra pelo custo de Atacado da ARKE e define o preço de Varejo (markup) cobrado do aluno. O Split Automático de Pagamento liquida os valores no checkout (Asaas).

| Nível | Custo Atacado ARKE | Taxa de processamento* | Sugestão de Varejo | Margem Sugerida da Academia |
|---|---|---|---|---|
| **Free** (app da academia) | — | — | — | incluso no plano B2B |
| **Integrado** (Treino + Nutrição) | R$ 45,00 | R$ 4,05 | R$ 119,00 | R$ 69,95 |
| **Elite** (Acompanhamento 360°) | R$ 85,00 | R$ 6,44 | R$ 199,00 | R$ 107,56 |

* Taxa do Asaas, somada ao atacado (decisão de 21/09/2026): 2,99% + R$ 0,49 sobre o valor cobrado, **com mínimo de R$ 1,99 por cobrança** (a taxa fixa do boleto e do PIX, desde 24/09/2026 — ver *Cobrança avulsa e taxa de matrícula*), configurável em Visão Master → Configurações. Os valores acima são no preço sugerido; com outro varejo, a taxa acompanha.

- **Free** (substitui o Essencial desde 22/09/2026): todo aluno matriculado e em dia com a academia — treinos com snapshot imutável, calendário, rotina, diário de água e dieta (a dieta vem da nutricionista **da academia**) e chat com os professores da academia. Sem custo de atacado: a academia paga só o plano B2B.
- **Integrado:** Tudo do Free + acolhimento M.A.P.A.®, fases da jornada, plano alimentar individualizado, acompanhamento por Nutricionista ARKE, check-ins semanais (R.O.T.A.®) e revisão integrada.
- **Elite:** Tudo do Integrado + acolhimento expandido, encontros periódicos de acompanhamento, relatórios de evolução corporal (A.P.E.X.®/L.E.G.A.D.O.®) e fila prioritária.

> Implementação: `planos_atacado` (custo de atacado + `valor_sugerido_varejo`) e `organization_planos_precificacao` (valor de varejo e markup definidos por organização — pré-preenchido com a sugestão ARKE via trigger ao criar a organização, editável livremente depois pela academia).

> **Desde 23/09/2026 os custos desta tabela são referência, e não o repasse cobrado:** o que vale é o negociado por academia (ver *Repasse Negociado por Academia*). A ArkeFit edita a referência em Visão Master → Configurações e a aplica a uma academia pela ficha dela (ver *A tabela de atacado de referência*).

### 3. Matriz de Repasse Financeiro no Gateway (Split no Asaas)
No momento da cobrança da assinatura do aluno:
1. `valor_repasse_arke` = `planos_atacado.custo_mensal` + `arke_taxa_processamento(valor_total_cobrado)` → direto para a conta da ARKE, que é de onde o Asaas desconta a taxa. Travado em `aluno_assinaturas.valor_repasse_arke` na criação.
2. `valor_liquido_academia` = `valor_total_cobrado - valor_repasse_arke` → direto para a conta/wallet da academia (`organizations.asaas_wallet_id`).

> Implementação: `aluno_assinaturas` (assinatura recorrente) + `pagamentos` (registro de cada cobrança com o split já calculado) + `asaas_webhook_events` (log/auditoria idempotente dos eventos do gateway). Edge Functions `asaas-create-subscription` e `asaas-webhook`.

## Resultado não é promessa (28/09/2026)

Duas decisões do responsável, tomadas juntas porque tratam da mesma coisa:

- **Números no site.** Só números de mercado com fonte citada, como já é hoje. Número próprio da ArkeFit entra com pelo menos 3 academias e 6 meses de uso, comparando antes e depois. Aparece como "observado", com período, número de academias e o método ao lado, e nunca como "garantido" ou "até X%". O número sai do banco, pela evasão de cada academia. A comparação antes e depois não separa o efeito do sistema do efeito de época do ano, e é por isso que o método vai escrito ao lado.
- **Contrato 2026-09-28.2.** A cláusula 8 diz que a ArkeFit não garante resultado de retenção, evasão, receita ou adesão, e que indicador é medição do período, não promessa.

A medida de retenção dos agentes é **antes e depois** (a evasão da academia nos 6 meses antes do ArkeFit contra os 6 meses com ele). O grupo de comparação, que deixaria alunos sem mensagem para medir, foi descartado pelo responsável.

## Dois ajustes comerciais no app do aluno (28/09/2026)

Decisões do responsável, depois dos testes do Jean:

- **Minha Jornada só no Método ARKE.** O item sai do menu do aluno do Free (`AppSidebar`, pelo `planoAluno` do `AuthContext`), e a rota, aberta por link antigo, mostra o convite do Método em vez da tela. A Jornada leva junto a aba **Compromisso** (a rotina da semana), que mora nela desde 23/09; no Free fica o calendário com a meta semanal e os treinos registrados.
- **Sem preço no app.** O cartão do Método e o aviso de recurso do Método (`MetodoArke`) dizem o que o Método traz e mandam à recepção, sem valor: o preço de cara barrava a venda antes da conversa. A regra de só oferecer quando a academia de fato vende (`metodo_ofertas_academia()`) continua; o preço de varejo segue definido pela academia em Precificação e usado na cobrança.
