import { cn } from "@/lib/utils";
import { corOrigem, rotuloOrigem } from "@/lib/crmComercial";

/** O canal do contato: o nome sempre escrito, a cor num ponto ao lado. */
export function TagOrigem({ origem, className }: { origem: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", corOrigem(origem))} aria-hidden />
      {rotuloOrigem(origem)}
    </span>
  );
}
