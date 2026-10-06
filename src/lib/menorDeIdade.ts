/**
 * Aluno menor de idade (decisão do responsável, 06/10/2026).
 *
 * "Pedir a data de nascimento. O menor se matricula e treina normalmente, mas
 * saúde, biometria e IA só liberam com o aceite do responsável, por um link
 * enviado ao e-mail dele." É o que a Política (art. 14 da LGPD) e os Termos já
 * prometiam, e que o sistema não fazia: nem a data de nascimento era pedida.
 *
 * Este módulo é a regra pura, para a tela e o teste. Quem trava de verdade é o
 * banco (`exigir_liberacao_consentimento`, migration `20261352010000`): a tela
 * só deixa de oferecer o que ia ser recusado. A conta da idade é a mesma dos
 * dois lados — `public.idade_em()` e `idadeEm()` aqui.
 *
 * As datas são texto `AAAA-MM-DD`, como as colunas `date` do Postgres, e "hoje"
 * é o de Brasília (`hojeBrasilia()`): nada aqui passa por `new Date()` de uma
 * data pura, que no Brasil vira o dia anterior.
 */

/** Os propósitos que, para o menor, dependem do aceite do responsável. */
export const PROPOSITOS_RESPONSAVEL = ["saude", "biometria", "ia_anamnese", "ia_chat"] as const;
export type PropositoResponsavel = (typeof PROPOSITOS_RESPONSAVEL)[number];

/** Nome de cada propósito para quem não é o aluno: o responsável e a equipe. */
export const ROTULO_PROPOSITO: Record<PropositoResponsavel, string> = {
  saude: "Dados de saúde (anamnese)",
  biometria: "Digital e rosto na catraca",
  ia_anamnese: "Resumo da anamnese por inteligência artificial",
  ia_chat: "Inteligência artificial no apoio às respostas do mentor",
};

export const MAIORIDADE = 18;
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function partes(data: string): [number, number, number] | null {
  const m = DATA.exec(data);
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Dia que não existe (31/02, 29/02 em ano comum) não é data.
  const diasNoMes = new Date(Date.UTC(a, me, 0)).getUTCDate();
  if (me < 1 || me > 12 || d < 1 || d > diasNoMes) return null;
  return [a, me, d];
}

/**
 * Idade completa em `hoje`. Quem nasceu em 29/02 completa ano em 01/03 nos anos
 * comuns (Código Civil, art. 132, § 3º: falta o dia correspondente, vale o
 * seguinte). É a conta de `public.idade_em()`.
 */
export function idadeEm(nascimento: string, hoje: string): number | null {
  const n = partes(nascimento);
  const h = partes(hoje);
  if (!n || !h) return null;
  const antesDoAniversario = h[1] < n[1] || (h[1] === n[1] && h[2] < n[2]);
  return h[0] - n[0] - (antesDoAniversario ? 1 : 0);
}

export type SituacaoIdade = "adulto" | "menor" | "desconhecida";

/** Sem data, a idade é desconhecida — e trava o mesmo que a do menor, até a data vir. */
export function situacaoIdade(nascimento: string | null | undefined, hoje: string): SituacaoIdade {
  const idade = nascimento ? idadeEm(nascimento, hoje) : null;
  if (idade === null) return "desconhecida";
  return idade >= MAIORIDADE ? "adulto" : "menor";
}

/**
 * Data de nascimento informada na matrícula ou no app: o erro para mostrar, ou
 * null quando está certa. As mesmas regras de `validar_data_nascimento()` no
 * banco: data que existe, não no futuro e não antes de 1900.
 */
export function erroDataNascimento(valor: string | null | undefined, hoje: string): string | null {
  const v = (valor ?? "").trim();
  if (!v) return "Informe a data de nascimento.";
  if (!partes(v)) return "Data de nascimento inválida: confira o dia, o mês e o ano.";
  if (v > hoje) return "A data de nascimento não pode ser no futuro.";
  if (v < "1900-01-01") return "Data de nascimento inválida: confira o ano.";
  return null;
}

/**
 * Data vinda de planilha, no formato que os sistemas exportam: `dd/mm/aaaa`,
 * `dd-mm-aaaa`, `aaaa-mm-dd` (com ou sem hora) ou o número de série do Excel.
 * O que não dá para ler com certeza volta null: na importação, data ilegível é
 * idade desconhecida, e não linha recusada — o aluno informa no app.
 */
export function lerDataDaPlanilha(valor: string | null | undefined, hoje: string): string | null {
  const v = (valor ?? "").trim();
  if (!v) return null;
  let iso: string | null = null;
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  const isoComHora = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v);
  if (br) iso = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  else if (isoComHora) iso = `${isoComHora[1]}-${isoComHora[2]}-${isoComHora[3]}`;
  else if (/^\d{4,5}$/.test(v)) {
    // Série do Excel: dias desde 30/12/1899 (o erro do 29/02/1900 já embutido).
    const dias = Number(v);
    const data = new Date(Date.UTC(1899, 11, 30) + dias * 86_400_000);
    iso = `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
  }
  return iso && !erroDataNascimento(iso, hoje) ? iso : null;
}

export type Liberacao = "livre" | "informar_data" | "pedir_responsavel";

/**
 * O que a tela faz antes de um consentimento sensível (saúde, biometria, IA):
 *   - adulto: segue, como sempre;
 *   - idade desconhecida: pede a data de nascimento, uma vez;
 *   - menor sem o aceite vigente do responsável para aquele propósito: pede o
 *     aceite dele, pelo link no e-mail.
 * Revogar nunca passa por aqui: retirar a autorização é sempre possível.
 */
export function liberacaoConsentimento(situacao: SituacaoIdade, aceiteDoResponsavelVigente: boolean): Liberacao {
  if (situacao === "adulto") return "livre";
  if (situacao === "desconhecida") return "informar_data";
  return aceiteDoResponsavelVigente ? "livre" : "pedir_responsavel";
}

/**
 * Os propósitos que fazem sentido pedir ao responsável deste aluno: saúde e IA
 * são do Método ARKE (o aluno do Free não passa por nenhum dos dois), e a
 * biometria só existe na academia com catraca. Pedir o que não existe ensina a
 * autorizar sem ler.
 */
export function propositosParaPedir(o: { noMetodo: boolean; temCatraca: boolean }): PropositoResponsavel[] {
  return PROPOSITOS_RESPONSAVEL.filter((p) => (p === "biometria" ? o.temCatraca : o.noMetodo));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Nome e e-mail do responsável, conferidos antes de ir ao servidor (que confere de novo). */
export function erroDadosResponsavel(o: { nome: string; email: string; emailDoAluno?: string | null }): string | null {
  const nome = o.nome.trim().replace(/\s+/g, " ");
  const email = o.email.trim().toLowerCase();
  if (nome.length < 3 || !nome.includes(" ")) return "Informe o nome completo do responsável.";
  if (nome.length > 120) return "Nome do responsável longo demais.";
  if (!EMAIL.test(email) || email.length > 254) return "E-mail do responsável inválido.";
  if (o.emailDoAluno && email === o.emailDoAluno.trim().toLowerCase()) {
    return "O e-mail precisa ser o do responsável, e não o seu.";
  }
  return null;
}
