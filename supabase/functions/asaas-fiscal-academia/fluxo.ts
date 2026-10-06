/**
 * O interruptor da nota fiscal automática ao salvar a configuração (serviço,
 * ISS, observação). Sem Deno e sem Supabase, para o teste do app exercitar
 * este código e não uma cópia — o mesmo critério dos outros `fluxo.ts`.
 *
 * Até 06/10/2026, salvar gravava `emissao_ativa: false` antes de conferir o
 * cadastro no Asaas, e só depois religava. Enquanto isso, e para sempre se a
 * conferência demorasse ou falhasse, o pagamento confirmado não entrava na
 * fila da nota (o gatilho só enfileira com a emissão ligada, e não retroage):
 * a nota daquele intervalo se perdia, sem aviso. Agora a emissão só desliga
 * por pedido da gestão ou quando a conferência diz que o cadastro deixou de
 * valer — e a tela fica sabendo.
 */

export type DecisaoEmissao =
  /** Grava a configuração e não mexe no interruptor. */
  | { acao: "manter" }
  /** Liga (estava desligada e o cadastro está pronto). */
  | { acao: "ligar" }
  /** Desliga; `erro` vai para a tela quando não foi a gestão que pediu. */
  | { acao: "desligar"; erro: string | null; desligadaAgora: boolean };

/**
 * `pedido`: o que a tela mandou no interruptor. `estavaAtiva`: o que estava
 * gravado. `pronta`: o cadastro conferido no Asaas agora (só importa quando a
 * tela pede ligada).
 */
export function decidirEmissao(p: { pedido: boolean; estavaAtiva: boolean; pronta: boolean }): DecisaoEmissao {
  if (!p.pedido) return { acao: "desligar", erro: null, desligadaAgora: p.estavaAtiva };
  if (p.pronta) return p.estavaAtiva ? { acao: "manter" } : { acao: "ligar" };
  return {
    acao: "desligar",
    desligadaAgora: p.estavaAtiva,
    erro: p.estavaAtiva
      ? "A emissão automática foi desligada: o Asaas não confirma mais o cadastro na prefeitura ou o serviço. Complete o que falta e ligue de novo; os pagamentos confirmados enquanto ela estiver desligada não geram nota."
      : "Complete o cadastro na prefeitura e o serviço antes de ligar a emissão.",
  };
}
