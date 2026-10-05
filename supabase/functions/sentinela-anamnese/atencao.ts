// A última linha da resposta do modelo diz se a anamnese pede atenção. Sem
// Deno nem Supabase, para o teste exercitar este código, e não uma cópia.
//
// Na dúvida, pede atenção. O roteiro manda escrever "ATENCAO", mas o modelo
// às vezes escreve "ATENÇÃO", ou esquece a linha. Antes, as duas coisas
// davam "não exige atenção": um aluno com lesão declarada aparecia como sem
// cuidado especial. Um alerta a mais custa uma leitura da anamnese; um a
// menos custa o aluno.

const LINHA = /ATEN[CÇ][AÃ]O\s*:\s*(SIM|N[AÃ]O)\s*$/i;

export function lerAtencao(texto: string): { resumo: string; exigeAtencao: boolean } {
  const t = texto.trim();
  const m = t.match(LINHA);
  if (!m) return { resumo: t, exigeAtencao: true };
  return {
    resumo: t.slice(0, m.index).trim(),
    exigeAtencao: m[1].toUpperCase() === "SIM",
  };
}
