/**
 * A identificação do Asaas como prestador nos e-mails que falam de cobrança e
 * da conta de recebimentos (art. 14 da Resolução Conjunta BCB/CMN nº
 * 16/2025, e o Playbook do BaaS do Asaas). Espelho de
 * `src/lib/prestadorPagamentos.ts`: `prestadorPagamentos.guarda.test.ts`
 * cobra os textos iguais e o bloco nos e-mails.
 *
 * O selo vem do endereço do Asaas, com o id da ArkeFit, e nunca é copiado; o
 * texto ao lado fica de pé sozinho quando o leitor de e-mail não carrega a
 * imagem (é o comum).
 */

export const SELO_ASAAS_POSITIVO =
  "https://baas.asaas.com/selos/Servicos_financeiros_Asaas-Reduzida-Positivo.svg?id=8c498bd4-a4a8-4188-9e7c-80bd120104b8";

export const TEXTO_PRESTADOR =
  "Pagamentos processados pelo Asaas (Asaas Gestão Financeira Instituição de Pagamento S.A., CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central.";

export const TEXTO_ATENDIMENTO_ASAAS =
  "Dúvidas sobre o pagamento em si (fatura, PIX, boleto, cartão, conta): atendimento do Asaas, 0800 009 0037 (pessoa jurídica; também por mensagem) e contato@asaas.com.br.";

const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** O bloco do prestador para o fim de um e-mail: em texto e em HTML. */
export function blocoPrestador(): { texto: string; html: string } {
  return {
    texto: `${TEXTO_PRESTADOR}\n${TEXTO_ATENDIMENTO_ASAAS}`,
    html: `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e5e5;color:#555;font-size:12px;line-height:1.5">
  <p style="margin:0 0 8px"><a href="https://asaas.com" target="_blank" rel="noopener noreferrer"><img src="${SELO_ASAAS_POSITIVO}" alt="Serviços financeiros Asaas" width="160" height="48" style="display:block;border:0"></a></p>
  <p style="margin:0 0 4px">${escapar(TEXTO_PRESTADOR)}</p>
  <p style="margin:0">${escapar(TEXTO_ATENDIMENTO_ASAAS)}</p>
</div>`,
  };
}
