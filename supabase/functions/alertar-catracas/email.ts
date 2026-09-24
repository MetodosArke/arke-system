// Texto do aviso de catraca fora do ar. Separado do index.ts, sem Deno nem
// Supabase, para o teste (src/lib/alertaCatracas.test.ts) importá-lo direto.

export type ItemCatraca = {
  catraca_id: string;
  organization_id: string;
  academia: string;
  catraca: string;
  tipo: "novo" | "lembrete" | "recuperou";
  situacao: string;
  sem_sinal_desde: string | null;
};

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function horario(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const rodape = (painel: string) =>
  `<p><a href="${painel}">Abrir no ARKE</a></p><p style="color:#6b7280">Enquanto a catraca continuar sem sinal, ` +
  `este aviso se repete a cada 24 h. Avisos só saem das 6h às 23h.</p>`;

/** Para a ArkeFit: todas as catracas, de todas as academias. */
export function montarEmailArkeFit(itens: ItemCatraca[], painel: string): { assunto: string; html: string; texto: string } {
  const fora = itens.filter((i) => i.tipo !== "recuperou");
  const voltaram = itens.filter((i) => i.tipo === "recuperou");
  const assunto = fora.length
    ? `[ArkeFit] ${fora.length} catraca(s) sem sinal`
    : `[ArkeFit] ${voltaram.length} catraca(s) de volta`;
  const linha = (i: ItemCatraca) =>
    i.tipo === "recuperou"
      ? `${i.academia} · ${i.catraca} ${i.situacao === "desativada" ? "foi desativada" : "voltou a falar com a nuvem"}`
      : `${i.tipo === "lembrete" ? "Ainda: " : ""}${i.academia} · ${i.catraca} sem sinal desde ${horario(i.sem_sinal_desde)}`;
  const blocos: string[] = [];
  const blocosTexto: string[] = [];
  if (fora.length) {
    blocos.push(`<p>Sem sinal do Gateway Local:</p><ul>${fora.map((i) => `<li>${escapar(linha(i))}</li>`).join("")}</ul>`);
    blocosTexto.push(`Sem sinal do Gateway Local:\n${fora.map((i) => `- ${linha(i)}`).join("\n")}`);
  }
  if (voltaram.length) {
    blocos.push(`<p>Voltaram:</p><ul>${voltaram.map((i) => `<li>${escapar(linha(i))}</li>`).join("")}</ul>`);
    blocosTexto.push(`Voltaram:\n${voltaram.map((i) => `- ${linha(i)}`).join("\n")}`);
  }
  const html =
    `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${blocos.join("")}` +
    `<p>O gestor de cada academia também foi avisado. Histórico e ações remotas em Visão Master → Equipamentos.</p>` +
    `${rodape(`${painel}/#/superadmin/equipamentos`)}</div>`;
  const texto = `${blocosTexto.join("\n\n")}\n\nO gestor de cada academia também foi avisado.\n${painel}/#/superadmin/equipamentos`;
  return { assunto, html, texto };
}

/**
 * Para o gestor: só as catracas da academia dele, com o que conferir — é ele
 * quem pode ir até o computador da recepção. Sem jargão de Gateway: o que ele
 * reconhece é "o computador da catraca" e "o programa da ArkeFit".
 */
export function montarEmailGestor(
  academia: string,
  itens: ItemCatraca[],
  painel: string
): { assunto: string; html: string; texto: string } {
  const fora = itens.filter((i) => i.tipo !== "recuperou");
  const voltaram = itens.filter((i) => i.tipo === "recuperou");
  const nomes = (l: ItemCatraca[]) => l.map((i) => i.catraca).join(", ");
  const assunto = fora.length
    ? `A catraca da ${academia} está sem sinal`
    : `A catraca da ${academia} voltou a funcionar`;

  const conferir = [
    "O computador da recepção, onde o programa da ArkeFit roda, está ligado?",
    "Ele está com internet?",
    "O programa ArkeFit Gateway está aberto? O ícone fica perto do relógio do Windows.",
  ];
  const partes: string[] = [];
  const partesTexto: string[] = [];
  if (fora.length) {
    const desde = fora
      .map((i) => `${i.catraca}: desde ${horario(i.sem_sinal_desde)}${i.tipo === "lembrete" ? " (ainda sem sinal)" : ""}`)
      .join("; ");
    partes.push(
      `<p>O ARKE perdeu contato com ${fora.length > 1 ? "as catracas" : "a catraca"} <strong>${escapar(nomes(fora))}</strong> ` +
        `(${escapar(desde)}).</p>` +
        `<p>Enquanto isso, a catraca decide pelo cadastro guardado no computador, se ele estiver ligado — ou não libera ninguém, se estiver desligado. Confira:</p>` +
        `<ul>${conferir.map((c) => `<li>${escapar(c)}</li>`).join("")}</ul>`
    );
    partesTexto.push(
      `O ARKE perdeu contato com: ${nomes(fora)} (${desde}).\n\nConfira:\n${conferir.map((c) => `- ${c}`).join("\n")}`
    );
  }
  if (voltaram.length) {
    partes.push(`<p>Voltou a funcionar: <strong>${escapar(nomes(voltaram))}</strong>.</p>`);
    partesTexto.push(`Voltou a funcionar: ${nomes(voltaram)}.`);
  }
  const link = `${painel}/#/admin/catracas`;
  const html =
    `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${partes.join("")}` +
    `<p>A ArkeFit também foi avisada.</p>${rodape(link)}</div>`;
  const texto = `${partesTexto.join("\n\n")}\n\nA ArkeFit também foi avisada.\n${link}`;
  return { assunto, html, texto };
}
