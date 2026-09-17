import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treinoTitulo: string;
  loading: boolean;
  onSubmit: (data: {
    nota: number;
    duracao_min: number;
    feedback: string;
    desconforto: boolean;
    desconforto_descricao: string;
  }) => void;
}

export function AvaliacaoTreinoDialog({
  open,
  onOpenChange,
  treinoTitulo,
  loading,
  onSubmit,
}: Props) {
  const [nota, setNota] = useState("5");
  const [duracao, setDuracao] = useState("30");
  const [desconforto, setDesconforto] = useState(false);
  const [desconfortoDesc, setDesconfortoDesc] = useState("");
  const [feedback, setFeedback] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      nota: parseInt(nota) || 5,
      duracao_min: parseInt(duracao) || 30,
      feedback,
      desconforto,
      desconforto_descricao: desconfortoDesc,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Avalie seu Treino</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Intensidade (1-10)</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={nota}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "" || /^\d+$/.test(val)) {
                  setNota(val);
                }
              }}
            />
          </div>

          <div>
            <Label>Duração do treino (minutos)</Label>
            <Input
              type="number"
              min={1}
              value={duracao}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "" || /^\d+$/.test(val)) {
                  setDuracao(val);
                }
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="desconforto"
              checked={desconforto}
              onCheckedChange={(checked) => setDesconforto(!!checked)}
            />
            <Label htmlFor="desconforto" className="cursor-pointer font-normal">
              Senti algum desconforto
            </Label>
          </div>

          {desconforto && (
            <div>
              <Label>Descreva o desconforto</Label>
              <Textarea
                value={desconfortoDesc}
                onChange={(e) => setDesconfortoDesc(e.target.value)}
                placeholder="Onde e como foi o desconforto..."
              />
            </div>
          )}

          <div>
            <Label>Observações Gerais (opcional)</Label>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Como foi o treino hoje..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {loading ? "Finalizando..." : "Finalizar Treino"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
