import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MiniaturaExercicio } from "@/components/acervo/MidiaExercicio";
import { useListasAcervo } from "@/hooks/useListasAcervo";
import { filtrarExercicios, gruposDe, type ExercicioBusca } from "@/lib/buscaExercicios";
import { cn } from "@/lib/utils";

export type ExercicioSelecionavel = ExercicioBusca & { gif_url?: string | null; video_url?: string | null };

const LIMITE = 60;

/**
 * Escolha do exercício na prescrição: filtros rápidos (grupo + equipamento +
 * texto) e a miniatura de cada um, para o treinador confirmar visualmente qual
 * é antes de inserir — trazido do app original. Antes era uma lista de nomes
 * num combobox.
 */
export function SeletorExercicio<T extends ExercicioSelecionavel>({
  exercicios,
  selecionadoId,
  onSelect,
}: {
  exercicios: T[];
  selecionadoId?: string;
  onSelect: (exercicio: T) => void;
}) {
  const { grupos, equipamentos } = useListasAcervo();
  const [texto, setTexto] = useState("");
  const [grupo, setGrupo] = useState<string | null>(null);
  const [equipamento, setEquipamento] = useState<string | null>(null);

  const encontrados = filtrarExercicios(exercicios, { texto, grupo, equipamento });

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input placeholder="Buscar exercício" aria-label="Buscar exercício" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Select value={grupo ?? "todos"} onValueChange={(v) => setGrupo(v === "todos" ? null : v)}>
          <SelectTrigger aria-label="Grupo muscular">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os grupos</SelectItem>
            {grupos.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={equipamento ?? "todos"} onValueChange={(v) => setEquipamento(v === "todos" ? null : v)}>
          <SelectTrigger aria-label="Equipamento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os equipamentos</SelectItem>
            {equipamentos.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border" aria-label="Exercícios encontrados">
        {encontrados.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nenhum exercício com esses filtros.</li>}
        {encontrados.slice(0, LIMITE).map((ex) => (
          <li key={ex.id}>
            <button
              type="button"
              onClick={() => onSelect(ex)}
              aria-pressed={selecionadoId === ex.id}
              className={cn(
                "w-full flex items-center gap-3 p-2 text-left hover:bg-muted/50 transition-colors",
                selecionadoId === ex.id && "bg-primary/10"
              )}
            >
              <MiniaturaExercicio imagemUrl={ex.gif_url} videoUrl={ex.video_url} nome={ex.nome} />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{ex.nome}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {gruposDe(ex).join(", ")}
                  {ex.equipamento ? ` · ${ex.equipamento}` : ""}
                  {ex.organization_id ? " · da academia" : ""}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {encontrados.length > LIMITE && (
        <p className="text-xs text-muted-foreground">Mostrando {LIMITE} de {encontrados.length}. Use os filtros para achar mais rápido.</p>
      )}
    </div>
  );
}
