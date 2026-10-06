// A data de nascimento na matrícula (decisão do responsável, 06/10/2026).
//
// Espelho de `src/lib/menorDeIdade.ts` (`erroDataNascimento` e `idadeEm`),
// duplicado em Deno pelo motivo de sempre: edge function não importa do
// bundle do app. `menorDeIdade.test.ts` roda os mesmos casos nos dois. O banco
// confere de novo (`validar_data_nascimento()`); isto existe para a mensagem
// chegar em português, na hora.
//
// "Hoje" vem de `hojeBrasilia()` (`_shared/data.ts`): a idade é a de Brasília.

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function partes(data: string): [number, number, number] | null {
  const m = DATA.exec(data);
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const diasNoMes = new Date(Date.UTC(a, me, 0)).getUTCDate();
  if (me < 1 || me > 12 || d < 1 || d > diasNoMes) return null;
  return [a, me, d];
}

/** Idade completa em `hoje`; 29/02 completa ano em 01/03 nos anos comuns. */
export function idadeEm(nascimento: string, hoje: string): number | null {
  const n = partes(nascimento);
  const h = partes(hoje);
  if (!n || !h) return null;
  const antesDoAniversario = h[1] < n[1] || (h[1] === n[1] && h[2] < n[2]);
  return h[0] - n[0] - (antesDoAniversario ? 1 : 0);
}

/** O erro para mostrar, ou null quando a data está certa. */
export function erroDataNascimento(valor: string | null | undefined, hoje: string): string | null {
  const v = (valor ?? "").trim();
  if (!v) return "Informe a data de nascimento.";
  if (!partes(v)) return "Data de nascimento inválida: confira o dia, o mês e o ano.";
  if (v > hoje) return "A data de nascimento não pode ser no futuro.";
  if (v < "1900-01-01") return "Data de nascimento inválida: confira o ano.";
  return null;
}
