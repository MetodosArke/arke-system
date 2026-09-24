// Texto do resumo diário do Vigia. Separado do index.ts, sem Deno nem
// Supabase, para o teste (src/lib/vigiaResumo.test.ts) importá-lo direto.
import { FERRAMENTAS, ROTULO_CAUSA, ROTULO_CLASSE, ROTULO_RECUSA } from "../_shared/vigiaAnalise.ts";

export type RegraResumo = {
  codigo: string;
  nivel: number;
  titulo: string;
  acao: string;
  modo: string;
  deteccoes: number;
  teria_agido: number;
  com_retentativa: number;
  sumiram_antes: number;
  mediana_min_sumiram: number | null;
  persistiram: number;
  escalariam: number;
  freios: number;
  abertas: number;
};

export type AcaoResumo = {
  ferramenta: string;
  alvo: string;
  alvo_nome: string;
  justificativa: string;
  classe: "sozinho" | "aprovacao" | "humano" | null;
  recusada?: "fora_do_catalogo" | "alvo_inexistente";
};

export type AnaliseResumo = {
  id: number;
  criada_em: string;
  status: string;
  modelo: string | null;
  diagnostico: string | null;
  causa_provavel: string | null;
  gravidade: string | null;
  confianca: number | null;
  anomalias: number;
  latencia_ms: number | null;
  motivo: string | null;
  acoes: AcaoResumo[];
};

export type Resumo = {
  ativo: boolean;
  sombra_desde: string;
  dia: number;
  dias_avaliacao: number;
  janela_horas: number;
  varreduras: number;
  regras: RegraResumo[];
  analises: {
    total: number;
    ok: number;
    indisponiveis: number;
    recusadas: number;
    invalidas: number;
    acoes_sozinho: number;
    acoes_aprovacao: number;
    acoes_humano: number;
    acoes_recusadas: number;
    lista: AnaliseResumo[];
  };
  total: { deteccoes: number; teria_agido: number; sumiram_antes: number; escalariam: number; analises: number };
};

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function horario(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function data(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function linhaRegra(r: RegraResumo): string {
  const partes = [plural(r.deteccoes, "detecção", "detecções")];
  if (r.teria_agido) {
    partes.push(`${r.nivel === 1 ? "teria agido" : "teria pedido aprovação"} em ${r.teria_agido} (${r.acao.toLowerCase()})`);
  }
  if (r.sumiram_antes) {
    const mediana = r.mediana_min_sumiram != null ? `, mediana de ${String(r.mediana_min_sumiram).replace(".", ",")} min` : "";
    partes.push(`${r.sumiram_antes} sumiu antes da hora de agir${mediana}`);
  }
  if (r.persistiram) partes.push(`${r.persistiram} continuou depois da ação prevista`);
  if (r.com_retentativa) partes.push(`${r.com_retentativa} pediria nova tentativa`);
  if (r.escalariam) partes.push(`${r.escalariam} iria para uma pessoa`);
  if (r.freios) partes.push(`${r.freios} segurada pelo freio de falha geral`);
  if (r.abertas) partes.push(`${r.abertas} aberta agora`);
  return `Nível ${r.nivel} · ${r.titulo}: ${partes.join("; ")}.`;
}

export function linhaAcao(a: AcaoResumo): string {
  const nome = FERRAMENTAS[a.ferramenta]?.rotulo ?? a.ferramenta;
  const classe = a.recusada ? ROTULO_RECUSA[a.recusada] : a.classe ? ROTULO_CLASSE[a.classe] : "";
  const alvo = a.alvo === "plataforma" ? "" : ` em ${a.alvo_nome}`;
  return `${nome}${alvo} — ${classe}${a.justificativa ? `. ${a.justificativa}` : ""}`;
}

export function cabecalhoAnalise(a: AnaliseResumo): string {
  if (a.status !== "ok") {
    const motivo = a.status === "indisponivel" ? "modelo indisponível" : a.status === "recusada_validacao" ? "quadro recusado pela validação" : "resposta inválida";
    return `${horario(a.criada_em)} · análise não concluída (${motivo})`;
  }
  const causa = a.causa_provavel ? ROTULO_CAUSA[a.causa_provavel as keyof typeof ROTULO_CAUSA] ?? a.causa_provavel : "";
  const confianca = a.confianca != null ? ` · confiança declarada ${a.confianca}%` : "";
  return `${horario(a.criada_em)} · gravidade ${a.gravidade ?? "?"} · ${causa}${confianca}`;
}

export function montarEmailResumo(r: Resumo, painel: string): { assunto: string; html: string; texto: string } {
  const ativas = r.regras.filter((g) => g.deteccoes || g.abertas || g.teria_agido || g.escalariam);
  const deteccoes = r.regras.reduce((s, g) => s + g.deteccoes, 0);
  const concluido = r.dia > r.dias_avaliacao;
  const fim = new Date(new Date(r.sombra_desde).getTime() + r.dias_avaliacao * 86_400_000).toISOString();

  const assunto = concluido
    ? `[ArkeFit] Vigia · avaliação do modo sombra concluída (dia ${r.dia})`
    : deteccoes || r.analises.total
      ? `[ArkeFit] Vigia · modo sombra, dia ${r.dia} de ${r.dias_avaliacao}: ${plural(deteccoes, "ocorrência", "ocorrências")}, ${plural(r.analises.total, "análise", "análises")}`
      : `[ArkeFit] Vigia · modo sombra, dia ${r.dia} de ${r.dias_avaliacao}: sem ocorrências`;

  const intro = [
    `Modo sombra: nada foi executado. Abaixo, o que o Vigia teria feito nas últimas ${r.janela_horas} h, em ${plural(r.varreduras, "varredura", "varreduras")}.`,
    ...(concluido
      ? [
          `O período de avaliação de ${r.dias_avaliacao} dias terminou em ${data(fim)}. O Vigia continua em modo sombra até a decisão de quais regras e ações passam a rodar.`,
        ]
      : []),
    ...(!r.ativo ? ["O Vigia está desligado em Visão Master → Vigia."] : []),
  ];

  const regras = ativas.length ? ativas.map(linhaRegra) : ["Nenhuma regra disparou."];

  const a = r.analises;
  const cabecalhoIA = a.total
    ? `${plural(a.total, "análise", "análises")}: ${a.ok} concluída(s)` +
      (a.indisponiveis ? `, ${a.indisponiveis} com o modelo indisponível` : "") +
      (a.recusadas ? `, ${a.recusadas} recusada(s) pela validação do quadro` : "") +
      (a.invalidas ? `, ${a.invalidas} com resposta inválida` : "") +
      `. Ações propostas: ${a.acoes_sozinho} faria sozinho, ${a.acoes_aprovacao} pediria aprovação, ${a.acoes_humano} pede uma pessoa` +
      (a.acoes_recusadas ? `, ${a.acoes_recusadas} recusada(s) por estar fora da lista` : "") +
      "."
    : "Nenhuma análise: o quadro de anomalias não mudou ou estava vazio.";
  const analises = a.lista.slice(0, 5).map((x) => ({
    titulo: cabecalhoAnalise(x),
    diagnostico: x.diagnostico ?? "",
    acoes: x.acoes.map(linhaAcao),
  }));

  const t = r.total;
  const acumulado =
    `Desde ${data(r.sombra_desde)}: ${plural(t.deteccoes, "detecção", "detecções")}, teria agido em ${t.teria_agido}, ` +
    `${t.sumiram_antes} sumiu antes da hora de agir, ${t.escalariam} iria para uma pessoa, ${plural(t.analises, "análise", "análises")} por IA.`;

  const link = `${painel}/#/superadmin/vigia`;
  const html =
    `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">` +
    intro.map((p) => `<p>${escapar(p)}</p>`).join("") +
    `<h3 style="font-size:15px;margin:16px 0 4px">Regras</h3><ul>${regras.map((l) => `<li>${escapar(l)}</li>`).join("")}</ul>` +
    `<h3 style="font-size:15px;margin:16px 0 4px">Análise por IA</h3><p>${escapar(cabecalhoIA)}</p>` +
    analises
      .map(
        (x) =>
          `<p style="margin:12px 0 2px"><strong>${escapar(x.titulo)}</strong></p>` +
          (x.diagnostico ? `<p style="margin:2px 0">${escapar(x.diagnostico)}</p>` : "") +
          (x.acoes.length ? `<ul>${x.acoes.map((l) => `<li>${escapar(l)}</li>`).join("")}</ul>` : ""),
      )
      .join("") +
    `<p style="margin-top:16px">${escapar(acumulado)}</p>` +
    `<p><a href="${link}">Abrir o Vigia no ARKE</a></p></div>`;
  const texto = [
    ...intro,
    "",
    "REGRAS",
    ...regras.map((l) => `- ${l}`),
    "",
    "ANÁLISE POR IA",
    cabecalhoIA,
    ...analises.flatMap((x) => ["", x.titulo, ...(x.diagnostico ? [x.diagnostico] : []), ...x.acoes.map((l) => `- ${l}`)]),
    "",
    acumulado,
    link,
  ].join("\n");
  return { assunto, html, texto };
}
