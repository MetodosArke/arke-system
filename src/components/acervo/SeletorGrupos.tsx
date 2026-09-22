import { cn } from "@/lib/utils";

/**
 * Vários grupos musculares por exercício, como no app original. O primeiro
 * marcado é o principal (é ele que aparece nas listas e nas fichas antigas).
 */
export function SeletorGrupos({
  opcoes,
  valor,
  onChange,
}: {
  opcoes: string[];
  valor: string[];
  onChange: (grupos: string[]) => void;
}) {
  const alternar = (g: string) => onChange(valor.includes(g) ? valor.filter((x) => x !== g) : [...valor, g]);
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Grupos musculares">
      {opcoes.map((g) => {
        const indice = valor.indexOf(g);
        const marcado = indice >= 0;
        return (
          <button
            key={g}
            type="button"
            onClick={() => alternar(g)}
            aria-pressed={marcado}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              marcado ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
            )}
          >
            {g}
            {indice === 0 && valor.length > 1 && <span className="ml-1 opacity-80">(principal)</span>}
          </button>
        );
      })}
    </div>
  );
}
