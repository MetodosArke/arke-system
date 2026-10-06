/**
 * Os caminhos da conta de recebimentos da academia, na etapa Recebimentos.
 *
 * A conta própria (a academia abre no site do Asaas e informa a carteira) é
 * o caminho de sempre. A subconta aberta pela ArkeFit é BaaS, e fica atrás do
 * interruptor `asaas_subcontas_baas` (resposta do Asaas de 06/10/2026):
 * desligado, ela só aparece para a organização em `trial`, que fala com o
 * sandbox — é onde se tira o print da tela para a habilitação, sem ligar nada
 * em produção. Espelho de `subcontaDisponivel` em
 * `supabase/functions/asaas-conta-academia/fluxo.ts`, que recusa do mesmo jeito.
 *
 * `subcontaBaas.guarda.test.ts` cobra que nenhuma tela ofereça a subconta sem
 * passar por aqui.
 */
export type CaminhoConta = "existente" | "criar";

export function subcontaDisponivelNaTela(subcontasLigadas: boolean | null | undefined, statusOrganizacao: string | null | undefined): boolean {
  return subcontasLigadas === true || statusOrganizacao === "trial";
}

export function caminhosDaConta(subcontasLigadas: boolean | null | undefined, statusOrganizacao: string | null | undefined): CaminhoConta[] {
  return subcontaDisponivelNaTela(subcontasLigadas, statusOrganizacao) ? ["existente", "criar"] : ["existente"];
}

/** Como a tela mostra cada situação de um grupo de documentos do Asaas. */
export const ROTULO_DOCUMENTO: Record<string, string> = {
  NOT_SENT: "Falta enviar",
  PENDING: "Em análise no Asaas",
  APPROVED: "Aprovado",
  REJECTED: "Recusado — envie de novo",
};

export type GrupoDeDocumentos = {
  id: string;
  status: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  responsavel: string | null;
  link: string | null;
  linkExpiraEm: string | null;
};

/** O grupo pede ação do titular (não enviado ou recusado)? Espelho de `grupoPendente` da função. */
export function grupoPendente(g: Pick<GrupoDeDocumentos, "status">): boolean {
  return g.status === "NOT_SENT" || g.status === "REJECTED";
}
