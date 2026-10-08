// A assinatura dos e-mails dos agentes que rodam em rotina: a Letícia
// (`agente-comercial`) e o Bruno (`agente-implantacao`).
//
// Os agentes assinam como equipe, nunca como pessoa (CLAUDE.md): assinar por
// uma pessoa que não existe faria a academia achar que falou com ela. A
// assinatura mora em `plataforma_textos` e pode ser trocada sem deploy; o que
// não for de equipe ("Equipe comercial ArkeFit") volta à padrão, aqui, que é o
// único caminho até o e-mail (07/10/2026).
//
// Sem Deno e sem Supabase, para o teste do app exercitar o código real.

export function assinaturaDeEquipe(configurada: string | null | undefined, padrao: string): string {
  const t = (configurada ?? "").replace(/\s+/g, " ").trim();
  return /^equipe\s/i.test(t) && t.length <= 80 ? t : padrao;
}
