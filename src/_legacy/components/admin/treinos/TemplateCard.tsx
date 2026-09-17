import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Send, Trash2, Pencil } from "lucide-react";
import { TemplateExercicios } from "./TemplateExercicios";
import { EnviarTemplateDialog } from "./EnviarTemplateDialog";

interface TemplateCardProps {
  template: {
    id: string;
    titulo: string;
    categoria: string;
    descricao: string | null;
    divisoes: string[];
  };
  onDelete: (id: string) => void;
  alunos: { user_id: string; full_name: string }[];
}

export function TemplateCard({ template, onDelete, alunos }: TemplateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeDivisao, setActiveDivisao] = useState(template.divisoes[0] || "A");
  const [enviarOpen, setEnviarOpen] = useState(false);

  return (
    <>
      <Card className="border-0 shadow-md overflow-hidden">
        <CardHeader
          className="cursor-pointer hover:bg-muted/30 transition-colors py-3 sm:py-4 px-3 sm:px-6"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-start sm:items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm sm:text-base truncate">{template.titulo}</p>
                {template.categoria && (
                  <Badge variant="outline" className="text-[10px] sm:text-xs shrink-0">
                    {template.categoria}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {template.divisoes.length} divisão(ões): {template.divisoes.join(", ")}
              </p>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <Button
                variant="default"
                size="sm"
                className="h-7 sm:h-8 text-xs sm:text-sm gap-1"
                onClick={(e) => { e.stopPropagation(); setEnviarOpen(true); }}
              >
                <Send className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="hidden sm:inline">Enviar</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8 text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.stopPropagation(); onDelete(template.id); }}
              >
                <Trash2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </Button>
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
        {expanded && (
          <CardContent className="border-t pt-4 px-3 sm:px-6">
            {template.descricao && (
              <p className="text-xs sm:text-sm text-muted-foreground mb-4">{template.descricao}</p>
            )}
            <div className="mb-4">
              <div className="flex gap-1.5 sm:gap-2 flex-wrap">
                {template.divisoes.map((d) => (
                  <Button
                    key={d}
                    variant={activeDivisao === d ? "default" : "outline"}
                    size="sm"
                    className="text-xs sm:text-sm h-7 sm:h-8 px-2.5 sm:px-3"
                    onClick={() => setActiveDivisao(d)}
                  >
                    Treino {d}
                  </Button>
                ))}
              </div>
            </div>
            <TemplateExercicios templateId={template.id} divisao={activeDivisao} />
          </CardContent>
        )}
      </Card>

      <EnviarTemplateDialog
        open={enviarOpen}
        onOpenChange={setEnviarOpen}
        template={template}
        alunos={alunos}
      />
    </>
  );
}
