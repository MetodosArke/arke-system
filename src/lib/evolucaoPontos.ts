// Regra de pontuação da Evolução (portada do app original): cada nova
// avaliação física é comparada com a META definida na avaliação ANTERIOR
// (direção + valor-alvo). Meta atingida = +20 pontos, meta superada
// (ultrapassou o alvo na direção certa) = +30. Sem meta anterior (ex.:
// primeira avaliação) = 0 pontos, nada a comparar ainda.
export type MetaDirecao = "manter" | "aumentar" | "diminuir";
export type StatusMeta = "atingida" | "superada" | "pendente";

export function statusDaMeta(
  valorAnterior: number,
  valorAtual: number,
  direcao: MetaDirecao,
  metaValor: number
): StatusMeta {
  if (direcao === "manter") {
    return Math.abs(valorAtual - valorAnterior) <= 0.5 ? "atingida" : "pendente";
  }
  if (direcao === "diminuir") {
    if (valorAtual > valorAnterior) return "pendente";
    return valorAtual <= metaValor ? "superada" : "atingida";
  }
  // aumentar
  if (valorAtual < valorAnterior) return "pendente";
  return valorAtual >= metaValor ? "superada" : "atingida";
}

export function pontosDoStatus(status: StatusMeta): number {
  if (status === "superada") return 30;
  if (status === "atingida") return 20;
  return 0;
}

export interface AvaliacaoParaPontos {
  peso_kg: number | null;
  percentual_gordura: number | null;
  musculo_percentual: number | null;
  meta_peso_kg: number | null;
  meta_peso_direcao: MetaDirecao | null;
  meta_gordura_valor: number | null;
  meta_gordura_direcao: MetaDirecao | null;
  meta_musculo_valor: number | null;
  meta_musculo_direcao: MetaDirecao | null;
}

interface StatusMetas {
  peso: StatusMeta | null;
  gordura: StatusMeta | null;
  musculo: StatusMeta | null;
}

// Calcula o status de cada meta da avaliação ANTERIOR comparada com os
// valores da avaliação ATUAL. Retorna null pra metas não definidas ou sem
// valor comparável.
export function calcularStatusMetas(anterior: AvaliacaoParaPontos | null, atual: AvaliacaoParaPontos): StatusMetas {
  if (!anterior) return { peso: null, gordura: null, musculo: null };

  const peso =
    anterior.meta_peso_direcao && anterior.meta_peso_kg != null && anterior.peso_kg != null && atual.peso_kg != null
      ? statusDaMeta(anterior.peso_kg, atual.peso_kg, anterior.meta_peso_direcao, anterior.meta_peso_kg)
      : null;

  const gordura =
    anterior.meta_gordura_direcao &&
    anterior.meta_gordura_valor != null &&
    anterior.percentual_gordura != null &&
    atual.percentual_gordura != null
      ? statusDaMeta(anterior.percentual_gordura, atual.percentual_gordura, anterior.meta_gordura_direcao, anterior.meta_gordura_valor)
      : null;

  const musculo =
    anterior.meta_musculo_direcao &&
    anterior.meta_musculo_valor != null &&
    anterior.musculo_percentual != null &&
    atual.musculo_percentual != null
      ? statusDaMeta(anterior.musculo_percentual, atual.musculo_percentual, anterior.meta_musculo_direcao, anterior.meta_musculo_valor)
      : null;

  return { peso, gordura, musculo };
}

export function calcularPontosTotais(anterior: AvaliacaoParaPontos | null, atual: AvaliacaoParaPontos): number {
  const { peso, gordura, musculo } = calcularStatusMetas(anterior, atual);
  return [peso, gordura, musculo].reduce((soma, status) => soma + (status ? pontosDoStatus(status) : 0), 0);
}
