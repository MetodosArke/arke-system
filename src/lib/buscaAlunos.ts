/**
 * A busca da lista de alunos (Alunos & Prescrições). A lista já vem inteira
 * do banco; a busca filtra na tela, sem ir ao banco a cada letra.
 *
 * Acha pelo nome, sem acento e sem diferença de maiúscula, em qualquer ordem
 * das palavras ("silva ana" acha "Ana Paula da Silva"); pelo telefone ou pelo
 * CPF, só pelos dígitos, com ou sem máscara.
 */

export type FiltroSituacao = "todas" | "em_dia" | "inadimplente" | "pausado";

export type AlunoBuscavel = {
  full_name: string | null;
  telefone?: string | null;
  cpf?: string | null;
  situacao_academia: string;
  anonimizado_em?: string | null;
};

export function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function filtrarAlunos<T extends AlunoBuscavel>(alunos: T[], busca: string, situacao: FiltroSituacao = "todas"): T[] {
  const termo = semAcento(busca);
  const palavras = termo.split(/\s+/).filter(Boolean);
  const digitos = busca.replace(/\D/g, "");
  return alunos.filter((a) => {
    if (situacao !== "todas" && a.situacao_academia !== situacao) return false;
    if (!palavras.length) return true;
    const nome = semAcento(a.full_name ?? "");
    if (palavras.every((p) => nome.includes(p))) return true;
    // Três dígitos ou mais para buscar por número: com menos, quase todo
    // telefone e todo CPF casariam.
    if (digitos.length >= 3 && digitos.length === busca.replace(/[\s().\-/+]/g, "").length) {
      const telefone = (a.telefone ?? "").replace(/\D/g, "");
      const cpf = (a.cpf ?? "").replace(/\D/g, "");
      return telefone.includes(digitos) || cpf.includes(digitos);
    }
    return false;
  });
}

/** Quantos alunos a tabela mostra de uma vez antes do "mostrar todos". */
export const LIMITE_NA_TELA = 100;
