/**
 * Leitura de plano alimentar em PDF — a parte que não depende de Deno, para o
 * teste do app exercitar o código real.
 *
 * O caminho: o navegador extrai o TEXTO do PDF (o arquivo não sai do aparelho
 * da nutricionista), a função tira as linhas de identificação que reconhece,
 * o modelo em São Paulo transforma o texto em refeições, e cada item volta
 * CONFERIDO contra o texto original antes de ir para a revisão.
 *
 * **A conferência existe porque o modelo inventa.** Testado em 25/09/2026 com
 * o Claude 3 Haiku no Bedrock: num PDF escaneado, sem texto, ele devolveu uma
 * dieta inteira que não estava no documento — aveia, morango, brócolis. Uma
 * dieta inventada chegando a um aluno é o pior defeito possível aqui. Por
 * isso: sem texto, nem chama o modelo; e item cujo alimento ou número não
 * aparece no original volta marcado para conferir, e se forem muitos a
 * leitura inteira é recusada.
 */

export interface ItemDieta {
  alimento: string;
  quantidade: string;
  substituicoes: string[];
  /** O alimento, a quantidade ou uma substituição não aparece assim no PDF. */
  conferir?: boolean;
}

export interface RefeicaoDieta {
  nome: string;
  horario: string | null;
  itens: ItemDieta[];
}

export interface DietaLida {
  titulo_dieta: string;
  observacoes_gerais: string | null;
  refeicoes: RefeicaoDieta[];
}

/** Texto que um plano alimentar razoável não passa. */
export const LIMITE_TEXTO = 60_000;
/** Abaixo disso, o PDF é imagem (escaneado) ou está vazio. */
export const MINIMO_LETRAS = 60;
/** Acima dessa fração de itens sem âncora no original, a leitura é recusada. */
export const LIMITE_SEM_ANCORA = 0.3;

const PALAVRAS_VAZIAS = new Set([
  "de", "da", "do", "das", "dos", "com", "sem", "para", "por", "uma", "um", "uns", "umas",
  "que", "ou", "e", "em", "no", "na", "nos", "nas", "a", "o", "as", "os", "ao", "aos", "ate",
]);

/** Minúsculas, sem acento, só letras e números separados por espaço. */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function temTextoSuficiente(texto: string): boolean {
  return (texto.match(/[A-Za-zÀ-ÿ]/g) ?? []).length >= MINIMO_LETRAS;
}

// Linhas que começam identificando a pessoa ("Paciente: Maria", "CPF: …").
const LINHA_DE_IDENTIFICACAO =
  /^\s*(paciente|cliente|aluno|aluna|nome( completo)?|cpf|rg|data de nascimento|nascimento|idade|telefone|celular|whatsapp|e-?mail|endere[cç]o)\s*[:\-–]/i;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const TELEFONE = /(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g;

/**
 * Tira, antes do envio, o que o sistema reconhece como identificação: linhas
 * de "Paciente:", "Nome:", "CPF:"… e números de CPF, e-mail e telefone em
 * qualquer lugar. Não promete pegar tudo — um nome solto no cabeçalho passa —,
 * e por isso a Política diz "as linhas de identificação que reconhece".
 */
export function tirarIdentificacao(texto: string): { texto: string; removidas: number } {
  let removidas = 0;
  const linhas = texto.split(/\r?\n/).filter((linha) => {
    if (LINHA_DE_IDENTIFICACAO.test(linha)) {
      removidas++;
      return false;
    }
    return true;
  });
  const limpo = linhas
    .join("\n")
    .replace(CPF, () => (removidas++, "[removido]"))
    .replace(EMAIL, () => (removidas++, "[removido]"))
    .replace(TELEFONE, () => (removidas++, "[removido]"));
  return { texto: limpo, removidas };
}

export const SISTEMA = `Você recebe o TEXTO de um plano alimentar escrito por uma nutricionista (extraído de um PDF). A sua única tarefa é transcrever esse plano para JSON. Você não é nutricionista: não sugere, não corrige, não completa e não inventa nada.

Responda SOMENTE com um JSON, sem nada antes ou depois, no formato:
{"titulo_dieta": "string", "observacoes_gerais": "string", "refeicoes": [{"nome": "string", "horario": "HH:MM ou string vazia", "itens": [{"alimento": "string", "quantidade": "string", "substituicoes": ["string"]}]}]}

Regras:
- Use as palavras do documento. Alimento, quantidade e substituição devem aparecer no texto.
- "refeicoes" na ordem do documento. Sem horário escrito, "horario" fica "".
- "substituicoes" só com as trocas escritas no documento para aquele item; sem nenhuma, lista vazia.
- "observacoes_gerais": as orientações gerais escritas no documento, ou "".
- Ignore dados de identificação de pessoas.
- Se o texto não tiver um plano alimentar, devolva "refeicoes": [].`;

/** O JSON da resposta do modelo, validado. Lança erro se não for uma dieta. */
export function lerResposta(bruto: string): DietaLida {
  const inicio = bruto.indexOf("{");
  const fim = bruto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) throw new Error("A resposta não trouxe um JSON.");
  const d = JSON.parse(bruto.slice(inicio, fim + 1)) as Record<string, unknown>;
  if (!Array.isArray(d.refeicoes)) throw new Error("A resposta não trouxe as refeições.");
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    titulo_dieta: texto(d.titulo_dieta),
    observacoes_gerais: texto(d.observacoes_gerais) || null,
    refeicoes: d.refeicoes
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map((r, i) => ({
        nome: texto(r.nome) || `Refeição ${i + 1}`,
        horario: texto(r.horario) || null,
        itens: (Array.isArray(r.itens) ? r.itens : [])
          .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
          .map((it) => ({
            alimento: texto(it.alimento),
            quantidade: texto(it.quantidade),
            substituicoes: Array.isArray(it.substituicoes) ? it.substituicoes.map(texto).filter(Boolean) : [],
          }))
          .filter((it) => it.alimento),
      })),
  };
}

function palavras(s: string): string[] {
  return normalizar(s)
    .split(" ")
    .filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p));
}

/** A frase aparece no original: metade das palavras dela e todos os números. */
function ancorado(frase: string, tokens: Set<string>): boolean {
  const numeros = normalizar(frase).match(/\d+/g) ?? [];
  if (numeros.some((n) => !tokens.has(n))) return false;
  const ps = palavras(frase);
  if (ps.length === 0) return numeros.length > 0 || normalizar(frase).split(" ").every((p) => !p || tokens.has(p));
  return ps.filter((p) => tokens.has(p)).length / ps.length >= 0.5;
}

/**
 * Confere cada item contra o texto original e marca o que não bate. Devolve a
 * dieta marcada, quantos itens há e quantos ficaram sem âncora.
 */
export function conferirNoOriginal(dieta: DietaLida, original: string): { dieta: DietaLida; itens: number; semAncora: number } {
  const tokens = new Set(normalizar(original).split(" "));
  let itens = 0;
  let semAncora = 0;
  const refeicoes = dieta.refeicoes.map((r) => ({
    ...r,
    itens: r.itens.map((it) => {
      itens++;
      const ok =
        ancorado(it.alimento, tokens) &&
        (!it.quantidade || ancorado(it.quantidade, tokens)) &&
        it.substituicoes.every((s) => ancorado(s, tokens));
      if (!ok) semAncora++;
      return ok ? { ...it } : { ...it, conferir: true };
    }),
  }));
  return { dieta: { ...dieta, refeicoes }, itens, semAncora };
}

/** O veredito da leitura, com a mensagem que vai para a tela. */
export function avaliarLeitura(itens: number, semAncora: number): { ok: true } | { ok: false; motivo: string } {
  if (itens === 0) {
    return { ok: false, motivo: "Não encontramos refeições neste PDF. Confira se é o plano alimentar, ou digite a dieta." };
  }
  if (semAncora / itens > LIMITE_SEM_ANCORA) {
    return {
      ok: false,
      motivo: "A leitura não bateu com o texto do PDF, então ela foi descartada para não criar uma dieta errada. Digite a dieta, ou tente o PDF exportado direto do programa em que ela foi montada.",
    };
  }
  return { ok: true };
}
