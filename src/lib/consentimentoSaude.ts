/**
 * Termo de consentimento de dados de saúde (LGPD, art. 11, I).
 *
 * **Por que é versionado.** O texto anterior dizia que os dados de saúde eram
 * usados *"exclusivamente pela equipe da sua academia, com acesso restrito ao
 * profissional responsável por você"*. Com o Mentor Centralizado isso deixou
 * de ser verdade: a célula da ArkeFit também lê a anamnese do aluno do Método.
 * O parecer jurídico de 23/09/2026 (item 3.3) concluiu que houve vício de
 * informação e determinou **recolher o consentimento**, não só corrigir o
 * texto daqui para a frente.
 *
 * Um carimbo de data sozinho não diz *qual texto* a pessoa aceitou, então não
 * havia como saber quem precisa reconfirmar. Daí a versão, no mesmo desenho de
 * `documentosLegais.ts` e do consentimento de IA: o aceite vale enquanto a
 * versão for a vigente, e mudar o texto sem mudar a versão aqui é o defeito
 * que este arquivo existe para impedir.
 *
 * Espelho de `public.versao_consentimento_saude()`. Mudou aqui, muda lá.
 */
export const VERSAO_CONSENTIMENTO_SAUDE = "2026-09-23";

export const TEXTO_CONSENTIMENTO_SAUDE =
  "As informações de saúde que você compartilha no ARKE (histórico de saúde, lesões, medicamentos, " +
  "rotina e objetivos) são dados sensíveis protegidos pela Lei Geral de Proteção de Dados (LGPD). " +
  "Elas são usadas para personalizar o seu acompanhamento — treino, dieta e atendimento — e o acesso " +
  "é restrito a quem atende você: os profissionais da sua academia e, se você contratar o Método " +
  "ARKE, também a equipe de mentoria da ArkeFit.";

export const CAIXA_CONSENTIMENTO_SAUDE =
  "Li e autorizo o tratamento dos meus dados de saúde para o acompanhamento do meu treino e da minha " +
  "nutrição, pelos profissionais da minha academia e, no Método ARKE, pela equipe de mentoria da ArkeFit.";
