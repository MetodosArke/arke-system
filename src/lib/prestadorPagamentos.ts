/**
 * A identificação do Asaas como prestador dos serviços de pagamento.
 *
 * Por quê (06/10/2026): o Asaas considera o modelo da ArkeFit BaaS — criamos
 * cobranças pelas academias, guardamos a chave da conta delas e mandamos o
 * dinheiro por split —, e a ArkeFit vai passar pela homologação do BaaS
 * (modelo A, "Direto Tomador"). Desde 28/11/2025 o BaaS segue a Resolução
 * Conjunta BCB/CMN nº 16/2025: pelo art. 14, o prestador aparece
 * identificado, de forma visível, nas telas, contratos, documentos e
 * instrumentos de pagamento. O Playbook do Asaas pede o **selo oficial**, com
 * o id individual da ArkeFit, em toda tela onde há movimentação ou gestão de
 * valores, e o canal de atendimento do Asaas ao lado.
 *
 * Regras do selo (Playbook):
 *   * carregado direto do endereço do Asaas, nunca copiado para o
 *     repositório — o Asaas atualiza a imagem num lugar só;
 *   * sem `referrerPolicy="no-referrer"`: o Asaas confere pelo Referer que o
 *     selo carregou (a nossa `Referrer-Policy` é
 *     `strict-origin-when-cross-origin`, e a CSP aceita `img-src https:`);
 *   * 160 × 48 de referência, com link para asaas.com;
 *   * tema claro, o positivo; tema escuro, o negativo branco;
 *   * o texto com a razão social e o CNPJ fica ao lado: é o que o leitor de
 *     tela lê, e o que fica quando a imagem não carrega.
 *
 * O id do selo não é segredo: está no endereço público da imagem.
 * `prestadorPagamentos.guarda.test.ts` cobra o componente nas telas.
 */

/** O id individual da ArkeFit no selo do Asaas. */
export const ID_SELO_ASAAS = "8c498bd4-a4a8-4188-9e7c-80bd120104b8";

const SELO = (variante: string) => `https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-${variante}.svg?id=${ID_SELO_ASAAS}`;

export const SELO_ASAAS = {
  /** Fundo claro. */
  positivo: SELO("Positivo"),
  /** Fundo claro, monocromático (impressão em preto). */
  negativoPreto: SELO("Negativo-Preto"),
  /** Fundo escuro. */
  negativoBranco: SELO("Negativo-Branco"),
} as const;

/** O tamanho de referência do selo, em pixels. */
export const TAMANHO_SELO = { largura: 160, altura: 48 } as const;

/** Para onde o selo leva. */
export const SITE_ASAAS = "https://asaas.com";

export const RAZAO_SOCIAL_ASAAS = "Asaas Gestão Financeira Instituição de Pagamento S.A.";
export const CNPJ_ASAAS = "19.540.550/0001-21";

/** O texto do prestador, sempre junto do selo (art. 14 da Resolução Conjunta nº 16/2025). */
export const TEXTO_PRESTADOR =
  `Pagamentos processados pelo Asaas (${RAZAO_SOCIAL_ASAAS}, CNPJ ${CNPJ_ASAAS}), instituição de pagamento autorizada pelo Banco Central.`;

/** O atendimento do Asaas ao cliente final (Playbook, p. 16). */
export const ATENDIMENTO_ASAAS = {
  telefone: "0800 009 0037",
  telefoneLink: "tel:08000090037",
  observacaoTelefone: "pessoa jurídica; também por mensagem",
  email: "contato@asaas.com.br",
} as const;

export const TEXTO_ATENDIMENTO_ASAAS =
  `Dúvidas sobre o pagamento em si (fatura, PIX, boleto, cartão, conta): atendimento do Asaas, ${ATENDIMENTO_ASAAS.telefone} (${ATENDIMENTO_ASAAS.observacaoTelefone}) e ${ATENDIMENTO_ASAAS.email}.`;

/**
 * Os Termos de Uso do Asaas, no endereço que o rodapé do site do Asaas liga
 * ("Termos de uso"). Conferido em 06/10/2026. Espelho de `TERMOS_ASAAS_URL`
 * em `supabase/functions/asaas-conta-academia/fluxo.ts`.
 */
export const TERMOS_ASAAS_URL =
  "https://central.ajuda.asaas.com/hc/pt-br/articles/32096847160859-Termos-e-Condi%C3%A7%C3%B5es-de-Uso";
