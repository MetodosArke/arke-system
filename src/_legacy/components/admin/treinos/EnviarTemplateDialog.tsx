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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: {
    id: string;
    titulo: string;
    descricao: string | null;
    divisoes: string[];
  };
  alunos: { user_id: string; full_name: string }[];
}

export function EnviarTemplateDialog({ open, onOpenChange, template, alunos }: Props) {
  const [tituloCustom, setTituloCustom] = useState(template.titulo);
  const [descricao, setDescricao] = useState(template.descricao || "");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [selectedAlunos, setSelectedAlunos] = useState<string[]>([]);
  const [currentAluno, setCurrentAluno] = useState("");
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const alunoOptions = alunos
    .filter((a) => !selectedAlunos.includes(a.full_name))
    .map((a) => a.full_name);

  const addAluno = (nome: string) => {
    if (nome && !selectedAlunos.includes(nome)) {
      setSelectedAlunos((prev) => [...prev, nome]);
    }
    setCurrentAluno("");
  };

  const removeAluno = (nome: string) => {
    setSelectedAlunos((prev) => prev.filter((n) => n !== nome));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAlunos.length === 0 || !tituloCustom) return;

    setLoading(true);

    // Fetch template exercises for all divisoes
    const { data: templateExercicios } = await (supabase
      .from("treino_template_exercicios") as any)
      .select("*")
      .eq("template_id", template.id);

    for (const alunoNome of selectedAlunos) {
      const aluno = alunos.find((a) => a.full_name === alunoNome);
      if (!aluno) continue;

      const grupoId = crypto.randomUUID();

      // Create treinos for each divisao
      for (const divisao of template.divisoes) {
        const { data: newTreino } = await supabase
          .from("treinos")
          .insert({
            titulo: tituloCustom,
            tipo: divisao,
            descricao: descricao || null,
            aluno_id: aluno.user_id,
            validade_inicio: dataInicio || null,
            validade_fim: dataFim || null,
            grupo_id: grupoId,
          } as any)
          .select()
          .single();

        if (newTreino && templateExercicios) {
          const exsForDivisao = templateExercicios.filter(
            (ex: any) => ex.divisao === divisao
          );
          if (exsForDivisao.length > 0) {
            await supabase.from("treino_exercicios").insert(
              exsForDivisao.map((ex: any) => ({
                treino_id: newTreino.id,
                exercicio_id: ex.exercicio_id,
                ordem: ex.ordem,
                series: ex.series,
                repeticoes: ex.repeticoes,
                descanso_seg: ex.descanso_seg,
                descanso_por_serie: ex.descanso_por_serie,
                observacoes: ex.observacoes,
              }))
            );
          }
        }
      }
    }

    setLoading(false);
    toast({
      title: "Template enviado!",
      description: `Treino criado para ${selectedAlunos.length} aluno(s)`,
    });
    queryClient.invalidateQueries({ queryKey: ["admin-treinos"] });
    onOpenChange(false);
    setSelectedAlunos([]);
    setTituloCustom(template.titulo);
    setDescricao(template.descricao || "");
    setDataInicio("");
    setDataFim("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar Template para Aluno(s)</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Nome do Treino (para o aluno)</Label>
            <Input
              value={tituloCustom}
              onChange={(e) => setTituloCustom(e.target.value)}
              placeholder="Customize o nome do treino"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Personalize o nome — ex: nome do aluno ou objetivo
            </p>
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Mensagem ou orientações para o aluno"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div>
              <Label>Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Selecionar Aluno(s)</Label>
            <SearchableSelect
              value={currentAluno}
              onValueChange={addAluno}
              options={alunoOptions}
              placeholder="Buscar aluno..."
            />
            {selectedAlunos.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedAlunos.map((nome) => (
                  <span
                    key={nome}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2.5 py-1 font-medium"
                  >
                    {nome}
                    <button
                      type="button"
                      onClick={() => removeAluno(nome)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={selectedAlunos.length === 0 || !tituloCustom || loading}>
              {loading ? "Enviando..." : `Enviar para ${selectedAlunos.length} aluno(s)`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
