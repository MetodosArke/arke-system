import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Props {
  grupoId: string;
  alunoId: string;
  tituloRotina: string;
}

const QUICK_OPTIONS = [
  { label: "🏊 Natação", value: "Natação" },
  { label: "🚴 Ciclismo", value: "Ciclismo" },
  { label: "🏃 Corrida", value: "Corrida" },
];

export function AdicionarTreinoAvulsoDialog({ grupoId, alunoId, tituloRotina }: Props) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [selectedQuick, setSelectedQuick] = useState<string | null>(null);
  const [descricao, setDescricao] = useState("");
  const [duracao, setDuracao] = useState("");
  const [distancia, setDistancia] = useState("");
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const finalNome = selectedQuick || nome;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalNome.trim()) return;

    setLoading(true);
    const { error } = await supabase.from("treinos").insert({
      titulo: finalNome.trim(),
      tipo: "avulso",
      descricao: descricao || null,
      aluno_id: alunoId,
      grupo_id: grupoId,
      duracao_esperada_min: duracao ? parseInt(duracao) : null,
      distancia_esperada_km: distancia ? parseFloat(distancia) : null,
    } as any);
    setLoading(false);

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Treino avulso adicionado!" });
    queryClient.invalidateQueries({ queryKey: ["admin-treinos"] });
    resetAndClose();
  };

  const resetAndClose = () => {
    setOpen(false);
    setNome("");
    setSelectedQuick(null);
    setDescricao("");
    setDuracao("");
    setDistancia("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs h-7 sm:h-8">
          <Plus className="mr-1 h-3 w-3" />
          Adicionar Treino Avulso
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Treino Avulso</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Modalidade</Label>
            <div className="flex flex-wrap gap-2 mt-2 mb-3">
              {QUICK_OPTIONS.map((mod) => {
                const isSelected = selectedQuick === mod.value;
                return (
                  <Button
                    key={mod.value}
                    type="button"
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    className={isSelected ? "" : ""}
                    onClick={() => {
                      setSelectedQuick(isSelected ? null : mod.value);
                      if (!isSelected) setNome("");
                    }}
                  >
                    {mod.label}
                  </Button>
                );
              })}
            </div>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ou digite o nome do treino..."
              disabled={!!selectedQuick}
            />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Orientações para o treino..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Duração Esperada (min)</Label>
              <Input
                type="number"
                value={duracao}
                onChange={(e) => setDuracao(e.target.value)}
                placeholder="Ex: 45"
                min={0}
              />
            </div>
            <div>
              <Label>Distância Esperada (km)</Label>
              <Input
                type="number"
                step="0.1"
                value={distancia}
                onChange={(e) => setDistancia(e.target.value)}
                placeholder="Ex: 5.5"
                min={0}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!finalNome.trim() || loading}>
              {loading ? "Adicionando..." : "Adicionar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
