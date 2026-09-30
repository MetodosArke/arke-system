import { forwardRef, type HTMLAttributes } from "react";
import { ArrowRightLeft, Bot, Mail, MessageCircle, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { ETAPAS, leticiaCuidando, motivoSemAcionar, rotuloInteresse, tempoNaEtapa, type ConfigLeticia } from "@/lib/crmComercial";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TagOrigem } from "./TagOrigem";
import { dataHora, mensagensEnviadas, motivoParou } from "./leticia";
import type { LeadComercial } from "./tipos";

export type AcoesCartao = {
  onEditar: (lead: LeadComercial) => void;
  onMover: (lead: LeadComercial, etapa: string) => void;
  onAcionar: (lead: LeadComercial) => void;
  acionando: string | null;
};

const linkWhatsapp = (telefone: string) => {
  const d = telefone.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("55") ? d : `55${d}`}`;
};

/** O que a Letícia fez ou pode fazer com este contato, numa linha. */
function LinhaLeticia({ lead, cfg, acoes }: { lead: LeadComercial; cfg: ConfigLeticia; acoes: AcoesCartao }) {
  const enviadas = mensagensEnviadas(lead);
  const ultima = enviadas[enviadas.length - 1];
  const parou = motivoParou(lead);
  const cuidando = leticiaCuidando(lead, cfg);

  if (parou) return <p className="text-[11px] text-muted-foreground">Letícia parou: {parou}</p>;
  if (ultima)
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Bot className="h-3 w-3 text-primary" aria-hidden />
        {enviadas.length === 1 ? "Letícia respondeu" : `Letícia: ${enviadas.length} e-mails`} em {dataHora(ultima.enviado_em!)}
      </p>
    );
  if (cuidando)
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Bot className="h-3 w-3 text-primary" aria-hidden />
        {lead.origem === "site" ? "Letícia vai responder em minutos" : "Letícia acionada: primeiro e-mail em horário útil"}
      </p>
    );
  if (lead.origem === "site" || lead.status !== "novo") return null;

  const motivo = motivoSemAcionar(lead, cfg);
  if (motivo) return <p className="text-[11px] text-muted-foreground">Letícia: {motivo}</p>;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 w-full border-primary/40 bg-primary/10 text-xs hover:bg-primary/20 hover:text-foreground"
      disabled={acoes.acionando === lead.id}
      onClick={() => acoes.onAcionar(lead)}
    >
      <Bot className="mr-1.5 h-3.5 w-3.5" /> {acoes.acionando === lead.id ? "Acionando…" : "Acionar Letícia"}
    </Button>
  );
}

type Props = {
  lead: LeadComercial;
  cfg: ConfigLeticia;
  acoes: AcoesCartao;
  /** Enquanto o cartão é arrastado, o original fica apagado e a cópia flutua. */
  fantasma?: boolean;
  flutuando?: boolean;
} & HTMLAttributes<HTMLElement>;

/**
 * O cartão do quadro: academia, contato, canal, há quanto tempo na etapa e o
 * que a Letícia fez. Arrasta-se pelo corpo (mouse, ou toque demorado no
 * celular); "Mover" faz o mesmo pelo menu, que é o caminho pelo teclado e o
 * mais fácil no celular.
 */
export const CartaoLead = forwardRef<HTMLElement, Props>(function CartaoLead(
  { lead, cfg, acoes, fantasma, flutuando, className, ...resto },
  ref,
) {
  const local = [lead.cidade, lead.uf].filter(Boolean).join("/");
  const interesse = rotuloInteresse(lead.interesse);
  const outras = ETAPAS.filter((e) => e.id !== lead.status);

  return (
    <article
      ref={ref}
      aria-label={lead.academia}
      className={cn(
        "space-y-2 rounded-lg border bg-card p-3 text-card-foreground shadow-sm transition-colors",
        "cursor-grab select-none hover:border-primary/40 active:cursor-grabbing",
        fantasma && "opacity-40",
        flutuando && "rotate-1 cursor-grabbing border-primary/60 shadow-xl",
        className,
      )}
      {...resto}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 text-left text-sm font-semibold leading-snug hover:underline"
          onClick={() => acoes.onEditar(lead)}
        >
          {lead.academia}
        </button>
        <TagOrigem origem={lead.origem} />
      </div>

      {(lead.nome || local) && (
        <p className="truncate text-xs text-muted-foreground">{[lead.nome, local].filter(Boolean).join(" · ")}</p>
      )}
      {interesse && <p className="text-[11px] text-muted-foreground">Interesse: {interesse}</p>}
      {lead.status === "perdido" && lead.motivo_perda && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Motivo:</span> {lead.motivo_perda}
        </p>
      )}

      <LinhaLeticia lead={lead} cfg={cfg} acoes={acoes} />

      <div className="flex items-center gap-0.5 border-t pt-2">
        {lead.telefone && (
          <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
            <a href={linkWhatsapp(lead.telefone)} target="_blank" rel="noreferrer" aria-label={`WhatsApp de ${lead.academia}`}>
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        {lead.email && (
          <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
            <a href={`mailto:${lead.email}`} aria-label={`E-mail de ${lead.academia}`}>
              <Mail className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        <span className="ml-1 text-[11px] text-muted-foreground" title="Tempo nesta etapa">
          {tempoNaEtapa(lead.status_desde)}
        </span>
        <div className="ml-auto flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Mover ${lead.academia} para outra etapa`}>
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">Mover para</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {outras.map((e) => (
                <DropdownMenuItem key={e.id} onSelect={() => acoes.onMover(lead, e.id)}>
                  {e.titulo}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Editar ${lead.academia}`} onClick={() => acoes.onEditar(lead)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
});
