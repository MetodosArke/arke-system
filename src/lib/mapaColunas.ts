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
  // Sobrenome antes do nome: "Last name" também casaria com \bname\b.
  { campo: "sobrenome", teste: (t) => /sobrenome|last\s*name|surname/.test(t) && !DE_OUTRO.test(t) },
  {
    campo: "full_name",
    teste: (t) => (/\bnome\b|\bname\b|^cliente$|^aluno$/.test(t)) && !DE_OUTRO.test(t) && !/sobrenome|\bsocial\b/.test(t),
  },
  { campo: "email", teste: (t) => /e-?mail|endereco eletronico/.test(t) && !DE_OUTRO.test(t) },
  // DDD em coluna própria: só quando o cabeçalho começa por ele ("DDD",
  // "DDD celular"). "Telefone com DDD" é o telefone inteiro.
  { campo: "ddd", teste: (t) => /^ddd\b/.test(t) && !DE_OUTRO.test(t) },
  // Celular antes do telefone genérico: quando a planilha tem os dois, o
  // celular é o que serve para o WhatsApp e para o primeiro acesso.
  { campo: "telefone", teste: (t) => /celular|whatsapp|\bmovel\b|mobile/.test(t) && !DE_OUTRO.test(t) },
  { campo: "telefone", teste: (t) => /telefone|\bfone\b|\bphone\b|\btel\b/.test(t) && !DE_OUTRO.test(t) && !/comercial|fixo/.test(t) },
  { campo: "cpf", teste: (t) => /\bcpf\b/.test(t) && !DE_OUTRO.test(t) },

  // Endereço: a prefeitura o exige na nota fiscal. "Endereço eletrônico" é
  // e-mail, "Estado civil" não é UF, e "Número" só conta sozinho — "Número
  // do cliente" é outra coisa.
  { campo: "cep", teste: (t) => /\bcep\b/.test(t) && !DE_OUTRO.test(t) },
  { campo: "complemento", teste: (t) => /\bcomplemento\b/.test(t) && !DE_OUTRO.test(t) },
  { campo: "bairro", teste: (t) => /\bbairro\b/.test(t) && !DE_OUTRO.test(t) },
  { campo: "cidade", teste: (t) => /\bcidade\b|\bmunicipio\b/.test(t) && !DE_OUTRO.test(t) && !/naturalidade|nascimento/.test(t) },
  { campo: "uf", teste: (t) => /^(uf|estado)$|\buf\b/.test(t) && !DE_OUTRO.test(t) },
  { campo: "endereco_numero", teste: (t) => /^(numero|n[oº°]?\.?|num\.?)$|numero d[oa] (endereco|residencia|casa)/.test(t) },
  {
    campo: "logradouro",
    teste: (t) => /\bendereco\b|\blogradouro\b|^rua$/.test(t) && !DE_OUTRO.test(t) && !/eletronico|e-?mail|numero|complemento|bairro|cidade|cep/.test(t),
  },

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

/**
 * Planilhas que separam o sobrenome ou o DDD numa coluna própria: junta antes
 * de validar. Sem isso o aluno entrava só com o primeiro nome, e o celular sem
 * DDD — que não serve para o WhatsApp nem para o primeiro acesso por QR, que
 * procura pelos últimos 10 dígitos.
 */
export function juntarPartes(registro: Record<string, string>): Record<string, string> {
  const r = { ...registro };
  const nome = (r.full_name ?? "").trim();
  const sobrenome = (r.sobrenome ?? "").trim();
  // Há exportação que repete o sobrenome dentro do nome: não duplica.
  if (sobrenome && !normalizarTexto(nome).endsWith(normalizarTexto(sobrenome))) {
    r.full_name = `${nome} ${sobrenome}`.trim();
  }
  const ddd = (r.ddd ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const telefone = (r.telefone ?? "").replace(/\D/g, "");
  // Só completa telefone sem DDD (8 ou 9 dígitos); o que já tem fica como está.
  if (ddd.length === 2 && telefone.length >= 8 && telefone.length <= 9) {
    r.telefone = `${ddd}${telefone}`;
  }
  return r;
}

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
