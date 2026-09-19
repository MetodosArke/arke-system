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

// meta_*_direcao aceita `string | null` (não o literal MetaDirecao) porque é
// o formato bruto que vem do Supabase: a coluna é `text` no banco, com a
// restrição pros 3 valores aplicada via CHECK constraint, não enum — o
// gerador de tipos não enxerga isso. A validação real é feita em tempo de
// execução por `comoMetaDirecao` dentro de `calcularStatusMetas`.
export interface AvaliacaoParaPontos {
  peso_kg: number | null;
  percentual_gordura: number | null;
  musculo_percentual: number | null;
  meta_peso_kg: number | null;
  meta_peso_direcao: string | null;
  meta_gordura_valor: number | null;
  meta_gordura_direcao: string | null;
  meta_musculo_valor: number | null;
  meta_musculo_direcao: string | null;
}

function comoMetaDirecao(valor: string | null): MetaDirecao | null {
  return valor === "manter" || valor === "aumentar" || valor === "diminuir" ? valor : null;
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

  const pesoDirecao = comoMetaDirecao(anterior.meta_peso_direcao);
  const peso =
    pesoDirecao && anterior.meta_peso_kg != null && anterior.peso_kg != null && atual.peso_kg != null
      ? statusDaMeta(anterior.peso_kg, atual.peso_kg, pesoDirecao, anterior.meta_peso_kg)
      : null;

  const gorduraDirecao = comoMetaDirecao(anterior.meta_gordura_direcao);
  const gordura =
    gorduraDirecao &&
    anterior.meta_gordura_valor != null &&
    anterior.percentual_gordura != null &&
    atual.percentual_gordura != null
      ? statusDaMeta(anterior.percentual_gordura, atual.percentual_gordura, gorduraDirecao, anterior.meta_gordura_valor)
      : null;

  const musculoDirecao = comoMetaDirecao(anterior.meta_musculo_direcao);
  const musculo =
    musculoDirecao &&
    anterior.meta_musculo_valor != null &&
    anterior.musculo_percentual != null &&
    atual.musculo_percentual != null
      ? statusDaMeta(anterior.musculo_percentual, atual.musculo_percentual, musculoDirecao, anterior.meta_musculo_valor)
      : null;

  return { peso, gordura, musculo };
}

export function calcularPontosTotais(anterior: AvaliacaoParaPontos | null, atual: AvaliacaoParaPontos): number {
  const { peso, gordura, musculo } = calcularStatusMetas(anterior, atual);
  return [peso, gordura, musculo].reduce((soma, status) => soma + (status ? pontosDoStatus(status) : 0), 0);
}
