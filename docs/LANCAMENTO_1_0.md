# Lançamento da versão 1.0 — checklist

A versão 1.0 fecha o que a auditoria 360° de 23/09/2026 encontrou pela metade:

- o Gateway Local recebe ordens da nuvem;
- a biometria tem o ciclo completo: o aluno autoriza no app ou pelo termo impresso, a recepção cadastra pela ficha, e a revogação apaga dos equipamentos;
- a Visão Master vê os equipamentos de todas as academias, e o gestor é avisado quando a catraca dele sai do ar.

O **Método ARKE está à venda desde o primeiro dia**. As catracas Henry e Dimep ficam para a implantação do primeiro cliente de cada marca, por decisão do responsável.

Este checklist tem três partes: o que vem **antes do primeiro cliente pagante**, a **ordem de publicação** da 1.0 e o roteiro de **implantação de cada academia**. O que continua pendente está em `docs/DECISOES_PENDENTES.md`.

## 1. Antes do primeiro cliente pagante (obrigatório)

Regra do responsável, de 23/09/2026: todo upgrade de infraestrutura acontece antes do primeiro cliente pagante estar implantado.

- [ ] **Supabase Pro.** Backup com recuperação a ponto no tempo e projeto que não pausa. Depois do upgrade:
  - trocar `limite_banco_mb` pelo disco contratado em **Visão Master → Configurações** — o aviso de capacidade passa de "o banco vai travar" para "vai custar mais";
  - ligar a **proteção de senha vazada** do Auth, que só existe no plano pago (`password_hibp_enabled` na configuração de Auth; dá para ligar pela API de gerenciamento). A checagem própria contra o HaveIBeenPwned continua valendo e não conflita.
- [ ] **Vercel Pro.** O plano Hobby proíbe uso comercial.
- [ ] **Resend pago.** O gratuito envia 100 e-mails por dia; uma importação de 400 alunos com convite já estoura.
- [ ] **Sentry** conforme o volume.
- [ ] **Teste de carga**, só depois dos upgrades — antes, ele mediria o limite do plano, não o sistema.
- [ ] **Canal de suporte** em Visão Master → Configurações (sem ele, o botão "falar com o suporte" do onboarding não aparece).
- [ ] **GIFs dos exercícios** no acervo global.

## 2. Publicação

A 1.0 está no ar desde 24/09/2026, com as migrations pós-deploy aplicadas; o teste de ponta a ponta da jornada do aluno roda de verdade a cada deploy.

**Rodada 360° de 24/09/2026:** as migrations `20261274010000` e `20261275010000` (esta depois do deploy da ficha nova) estão aplicadas.

**Cobrança avulsa (24/09/2026):** as migrations `20261276010000` e `20261277010000` estão aplicadas e as funções publicadas (`asaas-cobranca-avulsa`, e as versões novas de `asaas-webhook`, `asaas-reconciliar`, `academia-criar-matricula`, `excluir-aluno` e `anonimizar-aluno`). As telas entram com o merge.

**Nota fiscal automática (24/09/2026):** a migration `20261278010000` está aplicada e as funções publicadas (`nfse-emitir`, `asaas-fiscal-academia` e a versão nova de `convidar-membro`). A `20261279010000` (Política de Privacidade `2026-09-24`) foi aplicada depois do deploy com o texto novo, e a `20261280010000` (Contrato da Academia `2026-09-24`, com a cláusula de responsabilidade fiscal) segue a mesma ordem.

## 3. Implantação de cada academia

**Onboarding** (painel, 6 etapas): dados, recebimentos, planos, equipe, alunos, contrato. Sem ele concluído, alunos não entram no app e nada é cobrado.

**Método ARKE.** Para a academia vender, dois ajustes, e só com os dois o app oferece o Método aos alunos:

- a ArkeFit grava o repasse negociado em **Visão Master → ficha da organização → Repasse do Método**;
- a academia define o preço de varejo na precificação.

Sem eles o app não anuncia o Método (anunciar a quem não pode comprar mandaria o aluno à recepção à toa), e a cobrança recusa com a explicação de onde resolver.

**Catraca, se houver:**

1. Cadastrar o dispositivo em **Catracas** e copiar o token.
2. Gerar o instalador do **Gateway Local** (`npm run build:exe` e `iscc scripts\gateway-installer.iss`, numa máquina Windows com o Inno Setup) e instalar no computador da recepção. O executável não tem assinatura de código: o Windows mostra o aviso do SmartScreen na primeira execução, e isso foi aceito.
3. No `config.json`, informar o token, o `modelo_catraca` e, para Control iD, `controlid_equipamentos`, com o nome, o IP e a senha de cada catraca. A senha fica só nessa máquina.
4. Configurar o equipamento:
   - **Control iD:** ativar o modo online (Pro) apontando para o IP do Gateway e a porta 4571. Na iDBlock, configurar o Monitor e usar `confirmacao_giro: "catra_event"`.
   - **Topdata:** instalar a ponte e registrar a `Inner.dll` como administrador (`docs/PONTE_TOPDATA.md`).
   - **Henry e Dimep:** a integração é um projeto dessa implantação.
5. **Ensaio antes de abrir a porta** (`docs/MANUAL_GATEWAY_LOCAL.md`, seção 7). O emulador confirma que o Gateway está alcançável e que o aluno é liberado. Na tela Catracas, o Gateway precisa aparecer **No ar**, com a versão.
6. **Bancada no dia**, com o equipamento de verdade: o sentido de giro da borboleta montada (`sentido_entrada`), o tempo do cadastro remoto da digital, a leitura de digital em dedo de academia e as mensagens de erro do firmware. Anotar o que divergir do ensaio.
7. **Orientar a recepção**, que cuida do cadastro, da digital, do cartão e da exclusão:
   - a digital só é cadastrada depois de o aluno autorizar: no app (**Perfil → Privacidade**) ou, para quem não usa o app e está em dia, pelo **termo impresso** na ficha (imprimir, o aluno assina, anexar o termo assinado);
   - o **cartão** não depende de autorização e sai num clique (**Cadastrar cartão**), com o aluno encostando o cartão no leitor;
   - sem gestão remota (Topdata), o número do cartão vai no campo da ficha.
8. **Avisos:** catraca sem sinal por 10 minutos, das 6h às 23h, gera e-mail para o gestor da academia e para a ArkeFit, com o que conferir no computador da recepção.

**Nota fiscal, se a academia quiser emitir pelo ARKE** (**Financeiro → Notas fiscais**, só a gestão):

1. **Conta:** a subconta aberta pelo ARKE já vem conectada. Quem trouxe conta Asaas própria cola a chave de API dela (no Asaas: Integrações → Chave de API).
2. **Cadastro na prefeitura:** o formulário pede só o que a prefeitura da cidade exige — certificado A1, usuário e senha do portal, ou token — além de inscrição municipal e regime. Certificado e senhas vão direto ao Asaas.
3. **Serviço e ISS:** buscar o serviço (ginástica, 6.04) e conferir a alíquota com o contador da academia.
4. **Endereço dos alunos:** a prefeitura exige. Vem da planilha de importação quando ela tem as colunas; o aluno completa no app (Perfil) e a recepção, na ficha. Nota sem endereço espera, com o motivo na tela.
5. **Ligar a emissão.** Vale a partir daí: pagamentos anteriores não geram nota.

**Parceiros (Wellhub, TotalPass):** credenciais em **Integrações** (vão para o cofre); check-in confirmado pela recepção em **Catracas**, onde fica a conferência do mês para bater com o repasse.

## 4. O que a 1.0 provou, e como

- **Gateway, função publicada e banco reais, com o emulador no papel do equipamento:** 22 verificações — telemetria, cadastro do aluno, da digital e do cartão, liberação remota auditada, sincronização, diagnóstico, e a revogação apagando o aluno do equipamento e registrando a data.
- **Pela tela, num navegador**, com gestor e aluna temporários: 26 verificações em duas rodadas.
  - Da tela Catracas ao consentimento no app e à remoção no equipamento.
  - O termo impresso, do papel à digital liberada; o cartão num clique; "Aluno" no display.
- **Aviso de catraca pelo cron de verdade:** sem sinal, sem repetição, volta — com os e-mails do gestor e da ArkeFit entregues.
- **Exclusão e anonimização pelas funções publicadas:** os arquivos do aluno saem junto, e o termo da digital fica na anonimização como prova.
- **Banco, em transação revertida:** 15 grupos de canal e consentimento, 27 casos de painel, alerta, pseudonimização e cofre, 5 do vigia das funções agendadas e 16 do termo assinado e da oferta do Método.
- **Testes automatizados** no Gateway (3 mutações feitas de propósito, as 3 pegas) e no app.

O que só a primeira instalação prova está no item 6 da seção 3.
