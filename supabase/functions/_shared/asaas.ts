/**
 * Qual Asaas cada organização fala: sandbox ou produção.
 *
 * Decisão de 23/09/2026. Até aqui a URL e a chave do Asaas eram globais, o que
 * tornava impossível exercitar a corrente inteira de cobrança — aluno → edge
 * function → gateway → webhook → banco → gate de bloqueio — sem criar cobrança
 * de verdade, na conta de verdade. O `fluxo.ts` de cada função já era testável
 * em sandbox, mas isso cobre a conversa com o gateway, não a corrente.
 *
 * A regra é o status da organização, e não um secret separado, porque é o
 * status que já significa "isto é homologação": `trial` existe no projeto
 * **apenas como ferramenta de homologação**, nunca como oferta comercial, e só
 * o Super Admin o atribui. Amarrar o ambiente a ele torna impossível uma
 * academia pagante cair no sandbox por engano — para isso alguém teria de
 * colocá-la em trial, o que já é recusado pelo gatilho
 * `trg_proteger_status_organizacao`.
 *
 * Sem `ASAAS_SANDBOX_KEY` configurada, organização em trial **não** cai em
 * produção por omissão: a chamada é recusada. Cair em produção seria
 * exatamente o acidente que esta separação existe para impedir, e um erro
 * explícito é sempre melhor que uma cobrança real inesperada.
 */

export type AmbienteAsaas = {
  api: string;
  chave: string;
  /** "sandbox" ou "producao" — vai para o log e para a resposta, nunca a chave. */
  nome: "sandbox" | "producao";
};

export const API_PRODUCAO = "https://api.asaas.com/v3";
export const API_SANDBOX = "https://api-sandbox.asaas.com/v3";

/**
 * @param statusOrganizacao valor de `organizations.status`.
 * @param env leitor de variável de ambiente (injetado para ser testável fora do Deno).
 */
export function ambienteAsaas(
  statusOrganizacao: string | null | undefined,
  env: (nome: string) => string | undefined,
): AmbienteAsaas | { erro: string } {
  const ehHomologacao = statusOrganizacao === "trial";

  if (ehHomologacao) {
    const chave = env("ASAAS_SANDBOX_KEY");
    if (!chave) {
      return {
        erro:
          "Organização em homologação (trial) exige ASAAS_SANDBOX_KEY configurada. " +
          "Sem ela a cobrança não é emitida — não cai em produção por omissão.",
      };
    }
    // Guarda contra o acidente inverso: chave de produção no slot do sandbox
    // mandaria cobrança real a partir da homologação.
    if (!chave.startsWith("$aact_hmlg_")) {
      return { erro: "ASAAS_SANDBOX_KEY não é uma chave de sandbox ($aact_hmlg_...)." };
    }
    return { api: env("ASAAS_SANDBOX_URL") ?? API_SANDBOX, chave, nome: "sandbox" };
  }

  const chave = env("ASAAS_API_KEY");
  if (!chave) {
    return { erro: "ASAAS_API_KEY não configurada no projeto Supabase." };
  }
  return { api: env("ASAAS_API_URL") ?? API_PRODUCAO, chave, nome: "producao" };
}
