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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAcademias } from "@/hooks/useAcademias";

interface NovoTreinoDialogProps {
  alunos: { user_id: string; full_name: string }[];
}

const DIVISOES = ["A", "B", "C", "D", "E", "F", "G"];

export function NovoTreinoDialog({ alunos }: NovoTreinoDialogProps) {
  const [open, setOpen] = useState(false);
  const [alunoNome, setAlunoNome] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [academiaNome, setAcademiaNome] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [divisoes, setDivisoes] = useState<string[]>(["A"]);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { academias, addAcademia } = useAcademias();

  const alunoOptions = alunos.map((a) => a.full_name);
  const academiaOptions = academias.map((a) => a.nome);

  const toggleDivisao = (d: string) => {
    setDivisoes((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const aluno = alunos.find((a) => a.full_name === alunoNome);
    if (!aluno || !titulo || divisoes.length === 0) return;

    setLoading(true);
    const grupoId = crypto.randomUUID();

    let academiaId: string | null = null;
    if (academiaNome.trim()) {
      const found = academias.find(
        (a) => a.nome.toLowerCase() === academiaNome.trim().toLowerCase()
      );
      academiaId = found?.id || null;
    }

    const records = divisoes.map((d) => ({
      titulo,
      tipo: d,
      descricao: descricao || null,
      aluno_id: aluno.user_id,
      academia_id: academiaId,
      validade_inicio: dataInicio || null,
      validade_fim: dataFim || null,
      grupo_id: grupoId,
    }));

    const { error } = await supabase.from("treinos").insert(records as any);
    setLoading(false);

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Rotina criada com sucesso!" });
    queryClient.invalidateQueries({ queryKey: ["admin-treinos"] });
    setOpen(false);
    setAlunoNome("");
    setTitulo("");
    setDescricao("");
    setAcademiaNome("");
    setDataInicio("");
    setDataFim("");
    setDivisoes(["A"]);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gradient-primary text-primary-foreground w-full sm:w-auto text-sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Nova Rotina
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Rotina de Treino</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Cliente</Label>
            <SearchableSelect
              value={alunoNome}
              onValueChange={setAlunoNome}
              options={alunoOptions}
              placeholder="Selecione um cliente"
            />
          </div>
          <div>
            <Label>Nome da Rotina</Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Treino de Hipertrofia (Fase 1)"
              required
            />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva os objetivos/detalhes desta rotina"
            />
          </div>
          <div>
            <Label>Academia</Label>
            <SearchableSelect
              value={academiaNome}
              onValueChange={setAcademiaNome}
              options={academiaOptions}
              placeholder="Selecione a academia"
              onAddNew={async (nome) => {
                await addAcademia(nome);
              }}
              addNewLabel="Adicionar academia"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Data de Início</Label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </div>
            <div>
              <Label>Data de Fim</Label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
              />
            </div>
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
            <Button
              type="submit"
              disabled={!alunoNome || !titulo || divisoes.length === 0 || loading}
            >
              {loading ? "Criando..." : "Criar Rotina"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
