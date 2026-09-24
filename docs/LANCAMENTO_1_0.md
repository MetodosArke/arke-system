# Lançamento da versão 1.0 — checklist

A versão 1.0 fecha o que a auditoria 360° de 23/09/2026 encontrou pela metade:
o Gateway Local recebe ordens da nuvem, a biometria tem o ciclo completo (o
aluno autoriza no app, a recepção cadastra pela ficha, a revogação apaga dos
equipamentos), e a Visão Master vê os equipamentos de todas as academias. As
catracas Henry e Dimep ficam para a implantação do primeiro cliente de cada
marca, por decisão do responsável.

Este checklist tem três partes: o que vem **antes do primeiro cliente
pagante**, a **ordem de publicação** da 1.0, e o roteiro de **implantação de
cada academia**. Decisões em aberto estão em `docs/DECISOES_PENDENTES.md`.

## 1. Antes do primeiro cliente pagante (obrigatório)

Regra do responsável, de 23/09/2026: todo upgrade de infraestrutura acontece
antes do primeiro cliente pagante estar implantado.

- [ ] **Supabase Pro.** Backup com recuperação a ponto no tempo e projeto que
      não pausa. Depois do upgrade, trocar `limite_banco_mb` pelo disco
      contratado em **Visão Master → Configurações** — o aviso de capacidade
      passa de "o banco vai travar" para "vai custar mais".
- [ ] **Vercel Pro.** O plano Hobby proíbe uso comercial.
- [ ] **Resend pago.** O gratuito envia 100 e-mails por dia; uma importação de
      400 alunos com convite já estoura.
- [ ] **Sentry** conforme o volume.
- [ ] **Teste de carga**, só depois dos upgrades — antes, ele mediria o limite
      do plano, não o sistema.
- [ ] **Canal de suporte** em Visão Master → Configurações (sem ele, o botão
      "falar com o suporte" do onboarding não aparece).
- [ ] **GIFs dos exercícios** no acervo global.
- [ ] **Instalador do Gateway Local**: `npm run build:exe` e
      `iscc scripts\gateway-installer.iss` numa máquina Windows com o Inno
      Setup. O executável não tem assinatura de código: o Windows mostra o
      aviso do SmartScreen na primeira execução. Assinar exige certificado
      de código (decisão de custo).
- [ ] Conferir no GitHub que o teste **jornada do aluno** roda de verdade
      (não "skipped") depois de cada deploy.

## 2. Publicação da 1.0 — nesta ordem

Já está no banco e publicado (aplicado e provado em 23/09/2026): migrations
`20261243` a `20261248`, a edge function `catraca-comandos` e as versões novas
de `alertar-rotinas`, `lembrete-onboarding`, `briefing-semanal` e
`ativar-cadastro`. Falta:

1. [ ] **Merge do PR da 1.0** e o deploy de produção na Vercel.
2. [ ] **Só depois do deploy**, aplicar
       `supabase/migrations/20261249010000_limpeza_pos_deploy_1_0.sql`. Ela
       apaga as colunas de credencial em texto puro e a consulta antiga de
       Gateways; antes do deploy, as duas ainda são usadas pela tela
       publicada.
3. [ ] Regenerar `src/integrations/supabase/types.ts` (as colunas antigas
       saem dos tipos) e commitar.
4. [ ] Abrir **Visão Master → Equipamentos** e **Catracas** e conferir que
       carregam. Abrir **Integrações** e conferir que o cadastro de
       credencial mostra "no cofre".

## 3. Implantação de cada academia

**Onboarding** (painel, 6 etapas): dados, recebimentos, planos, equipe, alunos,
contrato. Sem ele concluído, alunos não entram no app e nada é cobrado.

**Catraca, se houver:**

1. Cadastrar o dispositivo em **Catracas** e copiar o token.
2. Instalar o **Gateway Local** no computador da recepção. No `config.json`,
   o token, `modelo_catraca` e, para Control iD, `controlid_equipamentos`
   com o nome, o IP e a senha de cada catraca. A senha fica só nessa máquina.
3. **Control iD:** ativar o modo online (Pro) apontando para o IP do Gateway
   e a porta 4571. Na iDBlock, configurar o Monitor e usar
   `confirmacao_giro: "catra_event"`. **Topdata:** instalar a ponte e
   registrar a `Inner.dll` como administrador (`docs/PONTE_TOPDATA.md`).
   **Henry e Dimep:** a integração é um projeto dessa implantação.
4. **Ensaio antes de abrir a porta** (`docs/MANUAL_GATEWAY_LOCAL.md`, seção 7):
   o emulador confirma que o Gateway está alcançável e que o aluno é liberado.
   Na tela Catracas, o Gateway precisa aparecer **No ar**, com a versão.
5. **Bancada no dia**, com o equipamento de verdade: o sentido de giro da
   borboleta montada (`sentido_entrada`), o tempo do cadastro remoto da
   digital, a leitura de digital em dedo de academia, e as mensagens de erro
   do firmware. Anotar o que divergir do ensaio.
6. **Orientar a recepção:** a digital só é cadastrada depois de o aluno
   autorizar no próprio app (**Perfil → Privacidade**). Quem não quiser ou não
   tiver o app usa cartão ou CPF, que não dependem de autorização.

**Parceiros (Wellhub, TotalPass):** credenciais em **Integrações** (vão para o
cofre); check-in confirmado pela recepção em **Catracas**, onde fica a
conferência do mês para bater com o repasse.

## 4. O que a 1.0 provou, e como

- **Gateway, função publicada e banco reais, com o emulador no papel do
  equipamento:** 22 verificações — telemetria, cadastro do aluno, da digital e
  do cartão, liberação remota auditada, sincronização, diagnóstico, e a
  revogação apagando o aluno do equipamento e registrando a data.
- **Pela tela, num navegador**, com gestor e aluna temporários: 16 verificações
  — da tela Catracas ao consentimento no app e à remoção no equipamento.
- **Banco, em transação revertida:** 15 grupos de canal e consentimento, 27
  casos de painel, alerta, pseudonimização e cofre, 5 do vigia das funções
  agendadas.
- **Testes automatizados:** 112 no Gateway (3 mutações feitas de propósito, as
  3 pegas) e 369 no app.

O que só a primeira instalação prova está no item 5 da seção 3.
