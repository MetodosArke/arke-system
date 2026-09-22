/**
 * Adesão à dieta por refeição: o aluno marca "Sim" ou "Não" em cada refeição
 * do plano, e o percentual sai disso — em vez de ele estimar um número numa
 * régua, que era como o app original e a primeira versão faziam.
 *
 * A marcação é guardada pela `ordem` da refeição no snapshot da dieta
 * (`dieta_adesao.refeicoes_marcadas`, ex.: {"1": true, "2": false}). A ordem é
 * estável dentro de uma versão publicada — o snapshot é imutável —, e uma
 * dieta nova gera outra linha de adesão por dia, com outro `dieta_id`.
 */
export type RefeicaoPlano = { ordem: number; nome: string; horario?: string | null };
export type Marcacoes = Record<string, boolean>;

/** Só as marcações de refeições que existem no plano; o resto é descartado. */
export function marcacoesDoPlano(refeicoes: RefeicaoPlano[], marcacoes: Marcacoes | null | undefined): Marcacoes {
  const validas: Marcacoes = {};
  for (const r of refeicoes) {
    const valor = marcacoes?.[String(r.ordem)];
    if (typeof valor === "boolean") validas[String(r.ordem)] = valor;
  }
  return validas;
}

/**
 * Percentual do dia: refeições cumpridas sobre o total do plano. Refeição sem
 * resposta conta como não cumprida — o número mede o plano, não só o que foi
 * respondido. Sem refeições no plano (dieta só em PDF), não há como calcular:
 * devolve null e a tela cai no percentual informado à mão.
 */
export function percentualAdesao(refeicoes: RefeicaoPlano[], marcacoes: Marcacoes | null | undefined): number | null {
  if (refeicoes.length === 0) return null;
  const validas = marcacoesDoPlano(refeicoes, marcacoes);
  const cumpridas = Object.values(validas).filter(Boolean).length;
  return Math.round((cumpridas / refeicoes.length) * 100);
}

export function respondidas(refeicoes: RefeicaoPlano[], marcacoes: Marcacoes | null | undefined): number {
  return Object.keys(marcacoesDoPlano(refeicoes, marcacoes)).length;
}
