/**
 * De-para automático das colunas na importação de alunos: reconhece os nomes
 * usados nas exportações dos sistemas mais comuns (EVO, Tecnofit, Next Fit,
 * Pacto) e variações em português e inglês. O gestor ainda confere e ajusta
 * na tela; o objetivo é chegar lá com quase tudo certo.
 *
 * Duas regras de segurança:
 *   - a primeira regra que casa vence, então as específicas vêm antes das
 *     genéricas ("Status do cliente" é situação, não nome; "Nome da mãe" não é
 *     o nome do aluno);
 *   - um campo só recebe uma coluna. Sem isso, a segunda coluna de telefone
 *     ou de nome sobrescrevia a primeira em silêncio, linha a linha.
 */

export const normalizarTexto = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const temPerimetria = (t: string) => /circunferencia|perimetro|perimetria|circumference/.test(t);
const temDobra = (t: string) => /dobra|prega\s*cutanea|skinfold|\bdc\b/.test(t);

// Colunas que citam outra pessoa (responsável, mãe, contato de emergência) ou
// outra coisa (plano, professor): nunca são o dado do aluno.
const DE_OUTRO = /\bmae\b|\bpai\b|responsavel|emergencia|recado|contato de|social|fantasia|\bplano\b|professor|consultor|vendedor|usuario|indicac/;

const REGRAS: { campo: string; teste: (t: string) => boolean }[] = [
  // Situação primeiro: "Status do cliente" (Tecnofit), "Situação do contrato" (Next Fit).
  { campo: "situacao", teste: (t) => /situacao|\bstatus\b|adimpl|inadimpl/.test(t) && !DE_OUTRO.test(t) },
  {
    campo: "full_name",
    teste: (t) => (/\bnome\b|\bname\b|^cliente$|^aluno$/.test(t)) && !DE_OUTRO.test(t) && !/sobrenome|\bsocial\b/.test(t),
  },
  { campo: "email", teste: (t) => /e-?mail/.test(t) && !DE_OUTRO.test(t) },
  // Celular antes do telefone genérico: quando a planilha tem os dois, o
  // celular é o que serve para o WhatsApp e para o primeiro acesso.
  { campo: "telefone", teste: (t) => /celular|whatsapp|\bmovel\b|mobile/.test(t) && !DE_OUTRO.test(t) },
  { campo: "telefone", teste: (t) => /telefone|\bfone\b|\bphone\b|\btel\b/.test(t) && !DE_OUTRO.test(t) && !/comercial|fixo/.test(t) },
  { campo: "cpf", teste: (t) => /\bcpf\b/.test(t) && !DE_OUTRO.test(t) },

  { campo: "perim_braco", teste: (t) => temPerimetria(t) && /\bbraco\b|\barm\b/.test(t) && !/antebraco|forearm/.test(t) },
  { campo: "perim_antebraco", teste: (t) => temPerimetria(t) && /antebraco|forearm/.test(t) },
  { campo: "perim_cintura", teste: (t) => temPerimetria(t) && /cintura|waist/.test(t) },
  { campo: "perim_abdomen", teste: (t) => temPerimetria(t) && /abdomen|abdominal/.test(t) },
  { campo: "perim_quadril", teste: (t) => temPerimetria(t) && /quadril|\bhip\b/.test(t) },
  { campo: "perim_coxa", teste: (t) => temPerimetria(t) && /coxa|thigh/.test(t) },
  { campo: "perim_panturrilha", teste: (t) => temPerimetria(t) && /panturrilha|\bcalf\b/.test(t) },

  { campo: "dc_triceps", teste: (t) => temDobra(t) && /triceps/.test(t) },
  { campo: "dc_subescapular", teste: (t) => temDobra(t) && /subescapular|subscapular/.test(t) },
  { campo: "dc_suprailiaca", teste: (t) => temDobra(t) && /supra.?ili/.test(t) },
  { campo: "dc_abdominal", teste: (t) => temDobra(t) && /abdomen|abdominal/.test(t) },
  { campo: "dc_coxa", teste: (t) => temDobra(t) && /coxa|thigh/.test(t) },
  { campo: "dc_peitoral", teste: (t) => temDobra(t) && /peitoral|peito|chest/.test(t) },
  { campo: "dc_axilar_media", teste: (t) => temDobra(t) && /axilar/.test(t) },

  { campo: "peso_kg", teste: (t) => /\bpeso\b|\bweight\b/.test(t) },
  { campo: "altura_cm", teste: (t) => /\baltura\b|\bheight\b|\bestatura\b/.test(t) },
  { campo: "percentual_gordura", teste: (t) => /gordura|body\s*fat|\bbf%?\b/.test(t) },
  { campo: "historico_clinico", teste: (t) => /historico|observa|\bobs\b|\bnota\b|\bnote\b/.test(t) },
];

export function detectarCampo(nomeColuna: string): string {
  const t = normalizarTexto(nomeColuna);
  return REGRAS.find((r) => r.teste(t))?.campo ?? "ignorar";
}

/** Mapa coluna → campo, com cada campo usado por uma coluna só (a primeira). */
export function mapearColunas(colunas: string[]): Record<string, string> {
  const usados = new Set<string>();
  const mapa: Record<string, string> = {};
  for (const coluna of colunas) {
    const campo = detectarCampo(coluna);
    if (campo !== "ignorar" && usados.has(campo)) {
      mapa[coluna] = "ignorar";
      continue;
    }
    if (campo !== "ignorar") usados.add(campo);
    mapa[coluna] = campo;
  }
  return mapa;
}
