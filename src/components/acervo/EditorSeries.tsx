import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TECNICAS, type SerieDetalhe, type TecnicaSerie } from "@/lib/seriesTreino";
import { Minus, Plus, Copy } from "lucide-react";

const MAX_SERIES = 10;

/**
 * Repetições, descanso e técnica por série — "Série 1: 12 | Série 2: 10 |
 * Série 3: 8, drop-set" —, em vez de um número só para todas. Trazido do app
 * original. Séries iguais continuam a um clique ("Igualar à 1ª").
 */
export function EditorSeries({ series, onChange }: { series: SerieDetalhe[]; onChange: (series: SerieDetalhe[]) => void }) {
  const mudar = (i: number, parcial: Partial<SerieDetalhe>) => onChange(series.map((s, j) => (j === i ? { ...s, ...parcial } : s)));
  const quantidade = (n: number) => {
    const alvo = Math.min(MAX_SERIES, Math.max(1, n));
    const ultima = series[series.length - 1] ?? { reps: "12", descanso_seg: 60, tecnica: null };
    onChange(alvo <= series.length ? series.slice(0, alvo) : [...series, ...Array.from({ length: alvo - series.length }, () => ({ ...ultima, tecnica: null }))]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Séries</span>
        <Button type="button" size="icon" variant="outline" className="h-7 w-7" aria-label="Menos uma série" onClick={() => quantidade(series.length - 1)}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">
          {series.length}
        </span>
        <Button type="button" size="icon" variant="outline" className="h-7 w-7" aria-label="Mais uma série" onClick={() => quantidade(series.length + 1)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        {series.length > 1 && (
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-7" onClick={() => onChange(series.map(() => ({ ...series[0], tecnica: null })))}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Igualar à 1ª
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {series.map((s, i) => (
          <div key={i} className="grid grid-cols-[3.5rem_1fr_1fr_1.3fr] items-center gap-2">
            <span className="text-xs text-muted-foreground">Série {i + 1}</span>
            <Input
              aria-label={`Repetições da série ${i + 1}`}
              placeholder="Reps"
              value={s.reps}
              onChange={(e) => mudar(i, { reps: e.target.value })}
              className="h-8"
            />
            <Input
              aria-label={`Descanso da série ${i + 1} em segundos`}
              placeholder="Descanso (s)"
              inputMode="numeric"
              value={String(s.descanso_seg)}
              onChange={(e) => mudar(i, { descanso_seg: Number(e.target.value.replace(/\D/g, "")) || 0 })}
              className="h-8"
            />
            <Select value={s.tecnica ?? "nenhuma"} onValueChange={(v) => mudar(i, { tecnica: v === "nenhuma" ? null : (v as TecnicaSerie) })}>
              <SelectTrigger className="h-8" aria-label={`Técnica da série ${i + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhuma">Normal</SelectItem>
                {TECNICAS.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
