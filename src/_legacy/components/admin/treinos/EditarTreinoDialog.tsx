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
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAcademias } from "@/hooks/useAcademias";
import type { TreinoGrupo } from "./TreinoCard";

interface EditarTreinoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grupo: TreinoGrupo;
  alunos: { user_id: string; full_name: string }[];
}

const DIVISOES = ["A", "B", "C", "D", "E", "F", "G"];

export function EditarTreinoDialog({ open, onOpenChange, grupo, alunos }: EditarTreinoDialogProps) {
  const [alunoNome, setAlunoNome] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [academiaNome, setAcademiaNome] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [divisoes, setDivisoes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { academias, addAcademia } = useAcademias();

  useEffect(() => {
    if (open && grupo) {
      setTitulo(grupo.titulo);
      setDescricao(grupo.descricao || "");
      setDataInicio(grupo.validade_inicio || "");
      setDataFim(grupo.validade_fim || "");
      setAlunoNome(grupo.aluno_nome);
      const academiaAtual = academias.find((a) => a.id === (grupo as any).academia_id);
      setAcademiaNome(academiaAtual?.nome || "");
      const currentDivisoes = grupo.treinos
        .filter((t) => t.tipo !== "avulso")
        .map((t) => t.tipo);
      setDivisoes(currentDivisoes.length > 0 ? currentDivisoes : ["A"]);
    }
  }, [open, grupo, academias]);

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

    let academiaId: string | null = null;
    if (academiaNome.trim()) {
      const found = academias.find(
        (a) => a.nome.toLowerCase() === academiaNome.trim().toLowerCase()
      );
      academiaId = found?.id || null;
    }

    try {
      const existingDivisoes = grupo.treinos
        .filter((t) => t.tipo !== "avulso")
        .map((t) => t.tipo);

      // Update existing treinos
      for (const t of grupo.treinos.filter((t) => t.tipo !== "avulso")) {
        if (divisoes.includes(t.tipo)) {
          await supabase
            .from("treinos")
            .update({
              titulo,
              descricao: descricao || null,
              aluno_id: aluno.user_id,
              academia_id: academiaId,
              validade_inicio: dataInicio || null,
              validade_fim: dataFim || null,
            } as any)
            .eq("id", t.id);
        }
      }

      // Update avulsos too (titulo, aluno, dates)
      for (const t of grupo.treinos.filter((t) => t.tipo === "avulso")) {
        await supabase
          .from("treinos")
          .update({
            titulo,
            aluno_id: aluno.user_id,
            academia_id: academiaId,
            validade_inicio: dataInicio || null,
            validade_fim: dataFim || null,
          } as any)
          .eq("id", t.id);
      }

      // Add new divisoes
      const newDivisoes = divisoes.filter((d) => !existingDivisoes.includes(d));
      if (newDivisoes.length > 0) {
        await supabase.from("treinos").insert(
          newDivisoes.map((d) => ({
            titulo,
            tipo: d,
            descricao: descricao || null,
            aluno_id: aluno.user_id,
            academia_id: academiaId,
            validade_inicio: dataInicio || null,
            validade_fim: dataFim || null,
            grupo_id: grupo.grupo_id,
          })) as any
        );
      }

      // Remove removed divisoes
      const removedDivisoes = existingDivisoes.filter((d) => !divisoes.includes(d));
      for (const d of removedDivisoes) {
        const treino = grupo.treinos.find((t) => t.tipo === d);
        if (treino) {
          await supabase.from("treino_exercicios").delete().eq("treino_id", treino.id);
          await supabase.from("treinos").delete().eq("id", treino.id);
        }
      }

      toast({ title: "Rotina atualizada com sucesso!" });
      queryClient.invalidateQueries({ queryKey: ["admin-treinos"] });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Rotina de Treino</DialogTitle>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!alunoNome || !titulo || divisoes.length === 0 || loading}
            >
              {loading ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
