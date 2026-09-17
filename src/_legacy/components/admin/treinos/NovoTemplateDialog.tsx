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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const DIVISOES = ["A", "B", "C", "D", "E", "F", "G"];

export function NovoTemplateDialog() {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [descricao, setDescricao] = useState("");
  const [divisoes, setDivisoes] = useState<string[]>(["A"]);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleDivisao = (d: string) => {
    setDivisoes((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo || divisoes.length === 0) return;

    setLoading(true);
    const { error } = await (supabase.from("treino_templates") as any).insert({
      titulo,
      categoria: categoria || "",
      descricao: descricao || null,
      divisoes,
    });
    setLoading(false);

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Template criado com sucesso!" });
    queryClient.invalidateQueries({ queryKey: ["admin-templates"] });
    setOpen(false);
    setTitulo("");
    setCategoria("");
    setDescricao("");
    setDivisoes(["A"]);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gradient-primary text-primary-foreground w-full sm:w-auto text-sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Novo Template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Template de Treino</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Nome do Template</Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Treino Iniciante com Dor no Joelho"
              required
            />
          </div>
          <div>
            <Label>Categoria</Label>
            <Input
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Ex: Iniciante, Avançado, Reabilitação..."
            />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva os objetivos deste template"
            />
          </div>
          <div>
            <Label>Divisões de Treino</Label>
            <div className="flex flex-wrap gap-3 mt-2">
              {DIVISOES.map((d) => (
                <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={divisoes.includes(d)}
                    onCheckedChange={() => toggleDivisao(d)}
                  />
                  <span className="text-sm font-medium">{d}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!titulo || divisoes.length === 0 || loading}>
              {loading ? "Criando..." : "Criar Template"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
