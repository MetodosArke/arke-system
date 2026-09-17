import { useState, useEffect } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  avulso: {
    id: string;
    titulo?: string;
    duracao_esperada_min?: number | null;
    distancia_esperada_km?: number | null;
  };
  descricaoRotina?: string | null;
}

export function EditarTreinoAvulsoDialog({ open, onOpenChange, avulso, descricaoRotina }: Props) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [duracao, setDuracao] = useState("");
  const [distancia, setDistancia] = useState("");
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (open && avulso) {
      setNome(avulso.titulo || "");
      setDescricao(descricaoRotina || "");
      setDuracao(avulso.duracao_esperada_min ? String(avulso.duracao_esperada_min) : "");
      setDistancia(avulso.distancia_esperada_km ? String(avulso.distancia_esperada_km) : "");
    }
  }, [open, avulso]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;

    setLoading(true);
    const { error } = await supabase
      .from("treinos")
      .update({
        titulo: nome.trim(),
        descricao: descricao || null,
        duracao_esperada_min: duracao ? parseInt(duracao) : null,
        distancia_esperada_km: distancia ? parseFloat(distancia) : null,
      } as any)
      .eq("id", avulso.id);
    setLoading(false);

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Treino avulso atualizado!" });
    queryClient.invalidateQueries({ queryKey: ["admin-treinos"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Treino Avulso</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Nome do Treino</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Corrida, Natação"
              required
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
              <Label>Duração (min)</Label>
              <Input
                type="number"
                value={duracao}
                onChange={(e) => setDuracao(e.target.value)}
                placeholder="Ex: 45"
                min={0}
              />
            </div>
            <div>
              <Label>Distância (km)</Label>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!nome.trim() || loading}>
              {loading ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
