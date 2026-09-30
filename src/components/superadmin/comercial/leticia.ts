import type { LeadComercial } from "./tipos";

const ORDEM = ["primeira", "retorno_1", "retorno_2"];

export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Os e-mails que a Letícia de fato mandou a este contato, na ordem. */
export function mensagensEnviadas(lead: LeadComercial) {
  return lead.leads_comerciais_mensagens
    .filter((m) => m.situacao === "enviada" && m.enviado_em)
    .sort((a, b) => ORDEM.indexOf(a.etapa) - ORDEM.indexOf(b.etapa));
}

/** Por que a Letícia parou com este contato, se parou. */
export function motivoParou(lead: LeadComercial): string | null {
  if (lead.agente_parou_motivo === "pediu_para_parar") return "pediu para não receber mais";
  if (lead.agente_parou_motivo === "endereco_invalido") return "o e-mail não existe";
  return null;
}
