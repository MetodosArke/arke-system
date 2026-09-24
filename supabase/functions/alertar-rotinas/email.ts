// Texto do alerta de rotinas. Separado do index.ts, sem Deno nem Supabase,
// para o teste (src/lib/alertaRotinas.test.ts) importá-lo direto.

export type Item = {
  nome: string;
  tipo: "novo" | "lembrete" | "recuperou";
  situacao: string;
  ultima_execucao: string | null;
  ultimo_erro: string | null;
};

const SITUACAO: Record<string, string> = {
  falhou: "falhou na última execução",
  atrasada: "parou de rodar",
  ok: "voltou a rodar normalmente",
  desativada: "foi desativada",
  nunca_rodou: "ainda não rodou",
  removida: "não existe mais",
};

// Capacidade anda no mesmo trilho (ver 20261242010000_alerta_capacidade_banco),
// mas não é rotina: não tem "última execução" nem "erro", e o nome técnico
// não diz nada a quem lê. O detalhe ("412 MB de 500 MB (82%)") vem em
// ultimo_erro.
const CAPACIDADE: Record<string, { titulo: string; situacao: Record<string, string> }> = {
  "capacidade:banco": {
    titulo: "Banco de dados",
    situacao: {
      banco_70: "passou de 70% do limite — hora de planejar o upgrade",
      banco_85: "passou de 85% do limite — no plano gratuito, ao chegar a 100% o banco fica somente leitura",
      ok: "voltou para abaixo de 70% do limite",
    },
  },
};
const ehCapacidade = (i: Item) => i.nome in CAPACIDADE;

// Catraca sem sinal (ver 20261246010000_equipamentos_painel_parceiros): o
// nome técnico é "catraca:<uuid>", que não diz nada; quem é vem no detalhe
// ("Tietê Fitness · Entrada: sem sinal desde 23/09 14:32").
const ehCatraca = (i: Item) => i.nome.startsWith("catraca:");
const SITUACAO_CATRACA: Record<string, string> = {
  catraca_offline: "está sem sinal do Gateway Local",
  ok: "voltou a falar com a nuvem",
  removida: "foi removida do ARKE",
};
const ehRotina = (i: Item) => !ehCapacidade(i) && !ehCatraca(i);

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function montarEmail(itens: Item[], painel: string): { assunto: string; html: string; texto: string } {
  const problemas = itens.filter((i) => i.tipo !== "recuperou");
  const recuperadas = itens.filter((i) => i.tipo === "recuperou");
  const rotinasProblema = problemas.filter(ehRotina);
  const capacidadeProblema = problemas.filter(ehCapacidade);
  const catracasProblema = problemas.filter(ehCatraca);
  const partes = [
    ...(rotinasProblema.length ? [`${rotinasProblema.length} rotina(s) com problema`] : []),
    ...capacidadeProblema.map((i) => `${CAPACIDADE[i.nome].titulo.toLowerCase()} acima de ${i.situacao === "banco_85" ? 85 : 70}% do limite`),
    ...(catracasProblema.length ? [`${catracasProblema.length} catraca(s) sem sinal`] : []),
  ];
  const assunto = problemas.length
    ? `[ArkeFit] ${partes.join(" · ")}`
    : recuperadas.every(ehCapacidade)
      ? `[ArkeFit] ${recuperadas.map((i) => CAPACIDADE[i.nome].titulo.toLowerCase()).join(" e ")} de volta abaixo de 70% do limite`
      : recuperadas.every(ehCatraca)
        ? `[ArkeFit] ${recuperadas.length} catraca(s) de volta`
        : `[ArkeFit] ${recuperadas.length} ${recuperadas.some((i) => !ehRotina(i)) ? "alerta(s)" : "rotina(s)"} voltaram ao normal`;

  const linhaCapacidade = (i: Item) => {
    const c = CAPACIDADE[i.nome];
    return { titulo: c.titulo, texto: c.situacao[i.situacao] ?? i.situacao, detalhe: i.ultimo_erro ?? "" };
  };
  // "Tietê Fitness · Entrada: sem sinal desde 23/09 14:32" → quem é e desde quando.
  const linhaCatraca = (i: Item) => {
    const [quem, desde] = (i.ultimo_erro ?? "").split(": ");
    return {
      quem: quem || "Uma catraca",
      texto: SITUACAO_CATRACA[i.situacao] ?? i.situacao,
      desde: desde ?? "",
    };
  };

  const linha = (i: Item) => {
    const prefixo = i.tipo === "lembrete" ? "Ainda: " : "";
    if (ehCapacidade(i)) {
      const c = linhaCapacidade(i);
      return `- ${prefixo}${c.titulo} ${c.texto}${c.detalhe ? `: ${c.detalhe}` : ""}`;
    }
    if (ehCatraca(i)) {
      const c = linhaCatraca(i);
      return `- ${prefixo}${c.quem} ${c.texto}${c.desde ? ` (${c.desde})` : ""}`;
    }
    const erro = i.ultimo_erro ? `\n   Erro: ${i.ultimo_erro}` : "";
    return `- ${prefixo}${i.nome} ${SITUACAO[i.situacao] ?? i.situacao} (última execução: ${dataHora(i.ultima_execucao)})${erro}`;
  };
  const linhaHtml = (i: Item) => {
    const prefixo = i.tipo === "lembrete" ? "<em>Ainda:</em> " : "";
    if (ehCapacidade(i)) {
      const c = linhaCapacidade(i);
      return `<li>${prefixo}<strong>${c.titulo}</strong> ${escapar(c.texto)}${c.detalhe ? `: ${escapar(c.detalhe)}` : ""}</li>`;
    }
    if (ehCatraca(i)) {
      const c = linhaCatraca(i);
      return `<li>${prefixo}<strong>${escapar(c.quem)}</strong> ${escapar(c.texto)}${c.desde ? ` (${escapar(c.desde)})` : ""}</li>`;
    }
    const erro = i.ultimo_erro ? `<br><code style="color:#b91c1c">${escapar(i.ultimo_erro)}</code>` : "";
    return `<li>${prefixo}<strong>${escapar(i.nome)}</strong> ${SITUACAO[i.situacao] ?? escapar(i.situacao)} — última execução: ${dataHora(i.ultima_execucao)}${erro}</li>`;
  };

  const blocos: string[] = [];
  const blocosTexto: string[] = [];
  if (problemas.length) {
    blocos.push(`<p>Precisam de atenção:</p><ul>${problemas.map(linhaHtml).join("")}</ul>`);
    blocosTexto.push(`Precisam de atenção:\n${problemas.map(linha).join("\n")}`);
  }
  if (recuperadas.length) {
    blocos.push(`<p>Voltaram ao normal:</p><ul>${recuperadas.map(linhaHtml).join("")}</ul>`);
    blocosTexto.push(`Voltaram ao normal:\n${recuperadas.map(linha).join("\n")}`);
  }
  const temCatraca = itens.some(ehCatraca);
  const rodape =
    "Detalhes em Visão Master → Webhooks. Enquanto o problema continuar, este aviso se repete a cada 24 h " +
    "(a cada 7 dias para o banco entre 70% e 85%)." +
    (temCatraca
      ? " Catraca sem sinal: Visão Master → Equipamentos, onde dá para ver o histórico e agir remotamente; o aviso só sai no horário configurado em Configurações."
      : "");
  const html =
    `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">` +
    (itens.some(ehRotina)
      ? `<p>As rotinas agendadas são o que abre tarefa na fila das academias, gera lançamentos e fotografa o MRR. ` +
        `Quando uma para, nada mais avisa.</p>`
      : "") +
    (catracasProblema.length
      ? `<p>Com o Gateway Local sem sinal, a catraca decide pelo cadastro guardado no computador da academia, se ele ` +
        `ainda estiver ligado — ou não decide nada, se estiver desligado.</p>`
      : "") +
    blocos.join("") +
    `<p><a href="${painel}">Abrir a Visão Master</a></p><p style="color:#6b7280">${rodape}</p></div>`;
  const texto = `${blocosTexto.join("\n\n")}\n\n${painel}\n${rodape}`;
  return { assunto, html, texto };
}
