import { useState } from "react";
import { Bot } from "lucide-react";
import { dataHora, mensagensEnviadas, motivoParou } from "./leticia";
import type { LeadComercial } from "./tipos";

const ETAPA: Record<string, string> = { primeira: "Resposta", retorno_1: "1º lembrete", retorno_2: "Último lembrete" };

/** Tudo o que a Letícia mandou a este contato, com o texto de cada e-mail. */
export function HistoricoLeticia({ lead }: { lead: LeadComercial }) {
  const [aberto, setAberto] = useState(false);
  const enviadas = mensagensEnviadas(lead);
  const parou = motivoParou(lead);
  if (!enviadas.length && !parou && !lead.agente_acionado_em) return null;

  return (
    <div className="space-y-2 rounded-md border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <Bot className="h-3.5 w-3.5 text-primary" aria-hidden />
        {lead.agente_acionado_em && <span>Acionada em {dataHora(lead.agente_acionado_em)}</span>}
        {enviadas.map((m) => (
          <span key={m.etapa}>
            {ETAPA[m.etapa] ?? m.etapa} em {dataHora(m.enviado_em!)}
            {m.etapa === "primeira" && m.origem_texto === "ia" && " (com frase da IA)"}
          </span>
        ))}
        {parou && <span className="font-medium text-foreground">Parou: {parou}</span>}
        {enviadas.length > 0 && (
          <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setAberto((v) => !v)}>
            {aberto ? "Esconder" : "Ver o que foi enviado"}
          </button>
        )}
      </div>
      {aberto &&
        enviadas.map((m) => (
          <div key={m.etapa} className="space-y-1">
            <p className="font-medium text-foreground">{m.assunto}</p>
            <p className="whitespace-pre-wrap text-muted-foreground">{(m.corpo ?? "").split("\n—")[0].trim()}</p>
          </div>
        ))}
    </div>
  );
}
