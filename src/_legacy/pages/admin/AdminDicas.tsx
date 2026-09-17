import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Lightbulb, Plus, Pencil, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

export default function AdminDicas() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingDica, setEditingDica] = useState<any>(null);
  const [conteudo, setConteudo] = useState("");

  const { data: dicas = [], isLoading } = useQuery({
    queryKey: ["admin-dicas"],
    queryFn: async () => {
      const { data } = await supabase
        .from("dicas_semanais" as any)
        .select("*")
        .order("created_at", { ascending: false });
      return (data as any[]) || [];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: { id?: string; conteudo: string }) => {
      const titulo = payload.conteudo.substring(0, 50);
      if (payload.id) {
        const { error } = await supabase
          .from("dicas_semanais" as any)
          .update({ titulo, conteudo: payload.conteudo } as any)
          .eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("dicas_semanais" as any)
          .insert({ titulo, conteudo: payload.conteudo, criado_por: user!.id } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-dicas"] });
      toast.success(editingDica ? "Dica atualizada!" : "Dica criada!");
      handleCloseDialog();
    },
    onError: () => toast.error("Erro ao salvar dica"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, ativa }: { id: string; ativa: boolean }) => {
      const { error } = await supabase
        .from("dicas_semanais" as any)
        .update({ ativa } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-dicas"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dicas_semanais" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-dicas"] });
      toast.success("Dica excluída!");
      setDeleteId(null);
    },
    onError: () => toast.error("Erro ao excluir"),
  });

  const handleOpenNew = () => {
    setEditingDica(null);
    setConteudo("");
    setDialogOpen(true);
  };

  const handleOpenEdit = (dica: any) => {
    setEditingDica(dica);
    setConteudo(dica.conteudo);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingDica(null);
    setConteudo("");
  };

  const handleSave = () => {
    if (!conteudo.trim()) {
      toast.error("Preencha o texto da dica");
      return;
    }
    upsertMutation.mutate({ id: editingDica?.id, conteudo });
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dicas da Semana</h2>
          <p className="text-sm text-muted-foreground">Gerencie as dicas exibidas para os alunos</p>
        </div>
        <Button onClick={handleOpenNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Dica
        </Button>
      </motion.div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">Carregando...</div>
      ) : dicas.length === 0 ? (
        <motion.div variants={item}>
          <Card className="border-0 shadow-md">
            <CardContent className="flex flex-col items-center py-10 text-center">
              <Lightbulb className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">Nenhuma dica cadastrada ainda</p>
              <Button onClick={handleOpenNew} variant="outline" className="mt-4 gap-2">
                <Plus className="h-4 w-4" />
                Criar primeira dica
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div variants={item} className="space-y-3">
          {dicas.map((dica: any) => (
            <Card key={dica.id} className="border-0 shadow-md">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                      <Lightbulb className="h-5 w-5 text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm line-clamp-3">{dica.conteudo}</p>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        {new Date(dica.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={dica.ativa}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: dica.id, ativa: checked })}
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEdit(dica)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(dica.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDica ? "Editar Dica" : "Nova Dica"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Texto da dica</Label>
              <Textarea
                placeholder="Escreva a dica que será exibida para os alunos..."
                value={conteudo}
                onChange={(e) => setConteudo(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={upsertMutation.isPending}>
              {editingDica ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir dica?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
