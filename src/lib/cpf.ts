/**
 * Validação de CPF por dígito verificador.
 *
 * Por que isto existe: o CPF é a chave de leitura da catraca e a chave de
 * deduplicação na importação de base. Planilha de sistema antigo chega com
 * CPF truncado, com dígito trocado, com "000.000.000-00" no lugar de vazio
 * — e nada disso falha na hora. Falha meses depois, quando o aluno encosta
 * o dedo na catraca e não entra, ou quando a mesma pessoa aparece duas
 * vezes na base. Validar na entrada é o único momento barato.
 *
 * O cálculo é o módulo 11 da Receita Federal: cada dígito verificador sai
 * da soma ponderada dos anteriores.
 */

/** Deixa só os dígitos — aceita CPF com pontuação, espaço ou vindo de planilha. */
export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

function digitoVerificador(base: string, pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) {
    soma += Number(base[i]) * (pesoInicial - i);
  }
  const resto = (soma * 10) % 11;
  // 10 e 11 valem zero por definição da regra, não por arredondamento.
  return resto >= 10 ? 0 : resto;
}

export function validarCpf(valor: string | null | undefined): boolean {
  if (!valor) return false;
  const cpf = somenteDigitos(valor);

  if (cpf.length !== 11) return false;

  // Sequências repetidas (00000000000, 11111111111...) passam no módulo 11
  // por acidente aritmético e são o preenchimento improvisado mais comum em
  // planilha. Rejeitar explicitamente.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  return (
    digitoVerificador(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    digitoVerificador(cpf.slice(0, 10), 11) === Number(cpf[10])
  );
}

/** Formata para exibição: 000.000.000-00. Devolve o valor original se não der. */
export function formatarCpf(valor: string | null | undefined): string {
  if (!valor) return "";
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11) return valor;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/**
 * Mensagem pronta para a tela. Separa "não preencheu" de "preencheu errado":
 * na importação de base, saber qual dos dois é o que decide entre corrigir a
 * planilha e ir atrás do documento do aluno.
 */
export function erroCpf(valor: string | null | undefined): string | null {
  if (!valor || !somenteDigitos(valor)) return null; // vazio é tratado por quem chama
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11) return "CPF deve ter 11 dígitos.";
  if (!validarCpf(cpf)) return "CPF inválido — confira os dígitos.";
  return null;
}
