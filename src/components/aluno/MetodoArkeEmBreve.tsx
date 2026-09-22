import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

const INCLUI = ["Acolhimento M.A.P.A.®", "Fases da jornada", "Chat com a nutricionista", "Acompanhamento Elite"];

/**
 * O que o Método ARKE soma ao plano Free, anunciado como "breve lançamento".
 * `recurso` é usado onde o aluno esbarra num item do Método (o chat com a
 * nutricionista): diz o que falta sem trancar a tela nem cobrar nada — o
 * Método ainda não está à venda.
 */
export function MetodoArkeEmBreve({ recurso }: { recurso?: string }) {
  if (recurso) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Método ARKE · breve lançamento
        </p>
        <p className="text-xs text-muted-foreground max-w-xs">
          {recurso} faz parte do Método ARKE, que chega em breve à sua academia.
        </p>
      </div>
    );
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="py-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" /> Método ARKE · breve lançamento
        </p>
        <p className="text-xs text-muted-foreground">
          Um acompanhamento completo de treino, nutrição e rotina, pensado para você chegar mais longe. Em breve na sua academia.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {INCLUI.map((item) => (
            <li key={item} className="text-[11px] rounded-full border border-primary/30 px-2 py-0.5 text-primary">
              {item}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
