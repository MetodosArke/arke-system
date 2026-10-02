/**
 * A tabela B2B como a página de vendas mostra (decisão de 02/10/2026).
 *
 * Preço e limite de alunos vêm de `planos_b2b_site()`, que lê a mesma tabela
 * da cobrança: o site nunca anuncia um preço diferente do que o sistema
 * cobra. Aqui ficam só os textos que não moram no banco (nome, para quem é,
 * suporte) e a regra de como cada número vira frase.
 *
 * O Método ARKE fica fora até o preço fixo dele ser definido.
 */

export type PlanoB2bSite = { plano: string; valor_mensal: number | string | null; limite_alunos: number | null };
export type TabelaSite = { planos?: PlanoB2bSite[] | null; implantacao?: number | string | null } | null | undefined;

export type CartaoPlano = {
  plano: string;
  nome: string;
  /** Para quem é: unidades e alunos ativos. */
  publico: string;
  /** "R$ 390", ou null quando é sob consulta. */
  preco: string | null;
  suporte: string;
};

const NOME: Record<string, string> = { growth: "Growth", enterprise: "Enterprise", redes: "Redes", custom: "Custom" };

const SUPORTE: Record<string, string> = {
  growth: "Suporte pelo canal de atendimento.",
  enterprise: "Suporte prioritário.",
  redes: "Suporte prioritário e SLAs dedicados.",
  custom: "Marca personalizada, suporte presencial e integrações sob demanda.",
};

const alunos = (n: number) => n.toLocaleString("pt-BR");

/** "R$ 390" (sem centavos quando não há), "R$ 1.290", "R$ 99,90". Null quando não há preço. */
export function precoDoSite(valor: number | string | null | undefined): string | null {
  const n = Number(valor);
  if (valor === null || valor === undefined || valor === "" || !Number.isFinite(n) || n <= 0) return null;
  const inteiro = Number.isInteger(n);
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: inteiro ? 0 : 2,
    maximumFractionDigits: inteiro ? 0 : 2,
  });
}

function publicoDoPlano(p: PlanoB2bSite, limiteGrowth: number | null): string {
  const limite = p.limite_alunos && p.limite_alunos > 0 ? p.limite_alunos : null;
  switch (p.plano) {
    case "growth":
      return limite ? `Uma unidade, até ${alunos(limite)} alunos ativos` : "Uma unidade";
    case "enterprise": {
      // O começo do Enterprise é o fim do Growth: mudar o limite do Growth em
      // Configurações muda as duas frases juntas.
      const inicio = limiteGrowth ? limiteGrowth + 1 : null;
      if (limite) return inicio ? `Uma unidade, de ${alunos(inicio)} a ${alunos(limite)} alunos ativos` : `Uma unidade, até ${alunos(limite)} alunos ativos`;
      return inicio ? `Uma unidade, a partir de ${alunos(inicio)} alunos ativos, sem limite` : "Uma unidade, sem limite de alunos";
    }
    case "redes":
      return "Até 3 unidades, cobrado na unidade principal";
    case "custom":
      return "Redes com mais de 3 unidades";
    default:
      return "";
  }
}

/** Os cartões da seção de planos, na ordem que a função do banco devolve. Plano desconhecido não aparece. */
export function cartoesDosPlanos(tabela: TabelaSite): { planos: CartaoPlano[]; implantacao: string | null } {
  const planos = (tabela?.planos ?? []).filter((p) => NOME[p.plano]);
  const growth = planos.find((p) => p.plano === "growth");
  const limiteGrowth = growth?.limite_alunos && growth.limite_alunos > 0 ? growth.limite_alunos : null;
  return {
    planos: planos.map((p) => ({
      plano: p.plano,
      nome: NOME[p.plano],
      publico: publicoDoPlano(p, limiteGrowth),
      preco: precoDoSite(p.valor_mensal),
      suporte: SUPORTE[p.plano],
    })),
    implantacao: precoDoSite(tabela?.implantacao),
  };
}
