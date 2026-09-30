import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ETAPAS, type ConfigLeticia } from "@/lib/crmComercial";
import { CartaoLead, type AcoesCartao } from "./CartaoLead";
import type { LeadComercial } from "./tipos";

// Primeiro onde o ponteiro está; fora de qualquer coluna, a que o cartão mais cobre.
const colisao: CollisionDetection = (args) => {
  const sob = pointerWithin(args);
  return sob.length ? sob : rectIntersection(args);
};

function CartaoArrastavel({ lead, cfg, acoes, arrastando }: { lead: LeadComercial; cfg: ConfigLeticia; acoes: AcoesCartao; arrastando: boolean }) {
  // Sem os atributos de acessibilidade do dnd-kit de propósito: o cartão tem
  // botões dentro, e o caminho pelo teclado é o menu "Mover", não o arrasto.
  const { setNodeRef, listeners } = useDraggable({ id: lead.id, data: { lead } });
  return <CartaoLead ref={setNodeRef} lead={lead} cfg={cfg} acoes={acoes} fantasma={arrastando} {...listeners} />;
}

function Coluna({
  etapa,
  leads,
  cfg,
  acoes,
  arrastandoId,
  vazio,
}: {
  etapa: (typeof ETAPAS)[number];
  leads: LeadComercial[];
  cfg: ConfigLeticia;
  acoes: AcoesCartao;
  arrastandoId: string | null;
  vazio?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id });
  const origem = arrastandoId ? leads.some((l) => l.id === arrastandoId) : false;

  return (
    <section aria-label={etapa.titulo} className="flex w-[16rem] shrink-0 snap-start flex-col">
      <header className="mb-2 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 font-sans text-sm font-semibold">
          {etapa.id === "ganho" && <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />}
          {etapa.id === "perdido" && <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden />}
          {etapa.titulo}
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{leads.length}</span>
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[8rem] flex-1 flex-col gap-2 rounded-xl border border-dashed border-transparent bg-muted/40 p-2 transition-colors",
          isOver && !origem && "border-primary/60 bg-primary/10",
        )}
      >
        {leads.map((l) => (
          <CartaoArrastavel key={l.id} lead={l} cfg={cfg} acoes={acoes} arrastando={arrastandoId === l.id} />
        ))}
        {leads.length === 0 && vazio && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{vazio}</p>}
      </div>
    </section>
  );
}

/**
 * O quadro do Pipeline: seis colunas, cartões que se arrastam entre elas. No
 * computador o arrasto começa depois de mexer o mouse alguns pixels (um clique
 * continua sendo clique); no celular, com o dedo parado um instante, para a
 * rolagem lateral continuar funcionando. Soltar em "Perdido" pede o motivo
 * antes de gravar: quem decide isso é `onMover`.
 */
export function QuadroPipeline({
  leads,
  cfg,
  acoes,
  vazioNovos,
}: {
  leads: LeadComercial[];
  cfg: ConfigLeticia;
  acoes: AcoesCartao;
  vazioNovos: string;
}) {
  const [arrastando, setArrastando] = useState<LeadComercial | null>(null);
  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const titulo = (id: unknown) => ETAPAS.find((e) => e.id === id)?.titulo ?? "fora de uma etapa";
  const nomeDe = (id: unknown) => leads.find((l) => l.id === id)?.academia ?? "o cartão";

  const inicio = (e: DragStartEvent) => setArrastando((e.active.data.current?.lead as LeadComercial) ?? null);
  const fim = (e: DragEndEvent) => {
    setArrastando(null);
    const lead = e.active.data.current?.lead as LeadComercial | undefined;
    const destino = e.over?.id;
    if (lead && typeof destino === "string" && destino !== lead.status) acoes.onMover(lead, destino);
  };

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={colisao}
      onDragStart={inicio}
      onDragEnd={fim}
      onDragCancel={() => setArrastando(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Movendo ${nomeDe(active.id)}.`,
          onDragOver: ({ over }) => (over ? `Sobre ${titulo(over.id)}.` : "Fora de uma etapa."),
          onDragEnd: ({ active, over }) => (over ? `${nomeDe(active.id)} solto em ${titulo(over.id)}.` : "Movimento cancelado."),
          onDragCancel: () => "Movimento cancelado.",
        },
      }}
    >
      {/* A rolagem lateral vai até a borda da tela, por baixo do espaçamento da página. */}
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-3 sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
        {ETAPAS.map((etapa) => (
          <Coluna
            key={etapa.id}
            etapa={etapa}
            leads={leads.filter((l) => l.status === etapa.id)}
            cfg={cfg}
            acoes={acoes}
            arrastandoId={arrastando?.id ?? null}
            vazio={etapa.id === "novo" ? vazioNovos : undefined}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {arrastando && <CartaoLead lead={arrastando} cfg={cfg} acoes={acoes} flutuando className="w-[16rem]" />}
      </DragOverlay>
    </DndContext>
  );
}
