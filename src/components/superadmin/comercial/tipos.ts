/** Uma linha de `leads_comerciais`, com os e-mails que a Letícia mandou. */
export type LeadComercial = {
  id: string;
  created_at: string;
  nome: string | null;
  academia: string;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  alunos_faixa: string | null;
  sistema_atual: string | null;
  mensagem: string | null;
  origem: string;
  origem_detalhe: string | null;
  interesse: string | null;
  status: string;
  status_desde: string;
  observacoes_vendedor: string | null;
  motivo_perda: string | null;
  email_enviado_em: string | null;
  agente_parou_em: string | null;
  agente_parou_motivo: string | null;
  agente_acionado_em: string | null;
  leads_comerciais_mensagens: MensagemLeticia[];
};

export type MensagemLeticia = {
  etapa: string;
  situacao: string;
  enviado_em: string | null;
  origem_texto: string | null;
  assunto: string | null;
  corpo: string | null;
};

/** As colunas que o quadro lê. */
export const COLUNAS_LEAD =
  "id, created_at, nome, academia, cidade, uf, telefone, email, alunos_faixa, sistema_atual, mensagem, origem, origem_detalhe, interesse, status, status_desde, observacoes_vendedor, motivo_perda, email_enviado_em, agente_parou_em, agente_parou_motivo, agente_acionado_em, leads_comerciais_mensagens(etapa, situacao, enviado_em, origem_texto, assunto, corpo)";
