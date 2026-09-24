// Texto do aviso imediato do Vigia: aprovação pedida e caso que precisa de
// uma pessoa. Separado do index.ts, sem Deno nem Supabase, para o teste
// (src/lib/vigiaAvisos.test.ts) importá-lo direto.

export type Aviso = {
  id: number;
  tipo: "aprovacao" | "escalada";
  regra: string;
  titulo: string;
  acao: string;
  descricao: string;
  desde: string;
};

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function montarEmailAvisos(avisos: Aviso[], painel: string): { assunto: string; html: string; texto: string } {
  const aprovar = avisos.filter((a) => a.tipo === "aprovacao");
  const pessoa = avisos.filter((a) => a.tipo === "escalada");
  const assunto =
    aprovar.length && pessoa.length
      ? `[ArkeFit] Vigia: ${aprovar.length} aprovação(ões) pendente(s) e ${pessoa.length} caso(s) para uma pessoa`
      : aprovar.length
        ? aprovar.length === 1
          ? `[ArkeFit] Vigia pede aprovação: ${aprovar[0].titulo}`
          : `[ArkeFit] Vigia pede ${aprovar.length} aprovações`
        : pessoa.length === 1
          ? `[ArkeFit] Vigia precisa de uma pessoa: ${pessoa[0].titulo}`
          : `[ArkeFit] Vigia precisa de uma pessoa em ${pessoa.length} casos`;

  const blocos: string[] = [];
  const texto: string[] = [];
  if (aprovar.length) {
    const linhas = aprovar.map((a) => `${a.titulo}: ${a.descricao}. Ação proposta: ${a.acao.toLowerCase()}.`);
    blocos.push(
      `<p><strong>Aguardando sua aprovação</strong> — nada acontece até alguém aprovar ou dispensar.</p>` +
        `<ul>${linhas.map((l) => `<li>${escapar(l)}</li>`).join("")}</ul>`,
    );
    texto.push(`AGUARDANDO SUA APROVAÇÃO (nada acontece até alguém aprovar ou dispensar)\n${linhas.map((l) => `- ${l}`).join("\n")}`);
  }
  if (pessoa.length) {
    const linhas = pessoa.map((a) => `${a.titulo}: ${a.descricao}. O Vigia tentou "${a.acao.toLowerCase()}" e o problema continua.`);
    blocos.push(
      `<p><strong>Precisa de uma pessoa</strong> — o Vigia esgotou as tentativas.</p>` +
        `<ul>${linhas.map((l) => `<li>${escapar(l)}</li>`).join("")}</ul>`,
    );
    texto.push(`PRECISA DE UMA PESSOA (o Vigia esgotou as tentativas)\n${linhas.map((l) => `- ${l}`).join("\n")}`);
  }
  const link = `${painel}/#/superadmin/vigia`;
  return {
    assunto,
    html:
      `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${blocos.join("")}` +
      `<p><a href="${link}">Abrir o Vigia no ARKE</a></p></div>`,
    texto: `${texto.join("\n\n")}\n\n${link}`,
  };
}
