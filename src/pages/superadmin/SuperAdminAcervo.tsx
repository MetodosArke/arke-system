import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Globe, PlayCircle, Dumbbell } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type ExercicioBiblioteca = Tables<"exercicios_biblioteca">;

const GRUPOS_MUSCULARES = ["Peito", "Costas", "Quadríceps", "Isquiotibiais", "Ombros", "Braços", "Core"] as const;

const FORM_VAZIO = {
  id: "",
  nome: "",
  grupo_muscular: "Peito" as (typeof GRUPOS_MUSCULARES)[number],
  series_padrao: "3",
  repeticoes_padrao: "12",
  descanso_padrao_seg: "60",
  video_url: "",
  descricao_execucao: "",
  gif_url: "",
};

// Catálogo "Padrão ArkeFit" — compartilhado com todas as academias da
// plataforma. Só o superadmin edita (RLS: organization_id IS NULL exige
// papel 'superadmin'). Uma academia individual nunca altera esta tabela
// direto — ao "editar" no Acervo dela, o sistema cria uma cópia própria
// em vez de mutar essas linhas.
export default function SuperAdminAcervo() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogAberto, setDialogAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<ExercicioBiblioteca | null>(null);
  const [busca, setBusca] = useState("");

  const { data: exercicios = [], isLoading } = useQuery({
    queryKey: ["exercicios-biblioteca-global"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exercicios_biblioteca")
        .select("*")
        .is("organization_id", null)
        .order("grupo_muscular")
        .order("nome");
      if (error) throw error;
      return data as ExercicioBiblioteca[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do exercício.");
      const payload = {
        nome: form.nome.trim(),
        grupo_muscular: form.grupo_muscular,
        series_padrao: Number(form.series_padrao) || 3,
        repeticoes_padrao: form.repeticoes_padrao.trim() || "12",
        descanso_padrao_seg: Number(form.descanso_padrao_seg) || 60,
        video_url: form.video_url.trim() || null,
        descricao_execucao: form.descricao_execucao.trim() || null,
        gif_url: form.gif_url.trim() || null,
      };
      if (form.id) {
        const { error } = await supabase.from("exercicios_biblioteca").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("exercicios_biblioteca")
          .insert({ ...payload, organization_id: null, origem: "padrao_arke" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: form.id ? "Exercício padrão atualizado" : "Exercício padrão adicionado" });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-global"] });
      // Refletir no acervo/picker de todas as academias que consomem esse mesmo catálogo global.
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-acervo"] });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca"] });
      setDialogAberto(false);
      setForm(FORM_VAZIO);
      setDetalheId(null);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const alternarAtivo = useMutation({
    mutationFn: async (ex: ExercicioBiblioteca) => {
      const { error } = await supabase.from("exercicios_biblioteca").update({ ativo: !ex.ativo }).eq("id", ex.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-global"] });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-acervo"] });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca"] });
    },
    onError: (error: Error) => toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
  });

  const excluirExercicio = useMutation({
    mutationFn: async () => {
      if (!excluir) return;
      const { error } = await supabase.from("exercicios_biblioteca").delete().eq("id", excluir.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Exercício padrão excluído" });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-global"] });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-acervo"] });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca"] });
      setExcluir(null);
      setDetalheId(null);
    },
    onError: (error: Error) => toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }),
  });

  const abrirEdicao = (ex: ExercicioBiblioteca) => {
    setForm({
      id: ex.id,
      nome: ex.nome,
      grupo_muscular: ex.grupo_muscular as (typeof GRUPOS_MUSCULARES)[number],
      series_padrao: String(ex.series_padrao),
      repeticoes_padrao: ex.repeticoes_padrao,
      descanso_padrao_seg: String(ex.descanso_padrao_seg),
      video_url: ex.video_url ?? "",
      descricao_execucao: ex.descricao_execucao ?? "",
      gif_url: ex.gif_url ?? "",
    });
    setDialogAberto(true);
  };

  const detalhe = exercicios.find((e) => e.id === detalheId) ?? null;
  const termo = busca.trim().toLowerCase();
  const exerciciosFiltrados = exercicios.filter(
    (e) => !termo || e.nome.toLowerCase().includes(termo) || e.grupo_muscular.toLowerCase().includes(termo)
  );

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Acervo Global — Padrão ArkeFit</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Catálogo de exercícios compartilhado com <strong>todas as academias</strong> da plataforma. Mudanças aqui
        aparecem para qualquer organização que ainda não tenha criado sua própria cópia — vídeo, GIF e descrição de
        execução refletem no app do aluno assim que uma ficha nova for publicada.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Exercícios ({exercicios.length})</CardTitle>
              <CardDescription>Clique no nome para ver o detalhe completo.</CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setForm(FORM_VAZIO);
                setDialogAberto(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Novo exercício padrão
            </Button>
          </div>
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou grupo muscular..."
            className="mt-2"
          />
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!isLoading && exerciciosFiltrados.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum exercício encontrado.</p>
          )}
          {exerciciosFiltrados.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exerciciosFiltrados.map((ex) => (
                  <TableRow key={ex.id} className="cursor-pointer" onClick={() => setDetalheId(ex.id)}>
                    <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{ex.nome}</TableCell>
                    <TableCell>{ex.grupo_muscular}</TableCell>
                    <TableCell>
                      <Badge variant={ex.ativo ? "default" : "secondary"}>{ex.ativo ? "Ativo" : "Inativo"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detalhe do exercício — clique no nome na lista abre este painel. */}
      <Sheet open={!!detalheId} onOpenChange={(open) => !open && setDetalheId(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {detalhe && (
            <>
              <SheetHeader className="text-left">
                <div className="flex items-start justify-between gap-2">
                  <SheetTitle>{detalhe.nome}</SheetTitle>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEdicao(detalhe)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setExcluir(detalhe)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{detalhe.grupo_muscular}</Badge>
                  <Badge variant="outline" className="gap-1">
                    <Globe className="h-3 w-3" /> Padrão ArkeFit (todas as academias)
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Séries padrão</p>
                    <p className="font-medium">{detalhe.series_padrao}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Repetições</p>
                    <p className="font-medium">{detalhe.repeticoes_padrao}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Descanso</p>
                    <p className="font-medium">{detalhe.descanso_padrao_seg}s</p>
                  </div>
                </div>

                {detalhe.descricao_execucao && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Como executar</p>
                    <p className="text-sm whitespace-pre-wrap">{detalhe.descricao_execucao}</p>
                  </div>
                )}

                {detalhe.gif_url && (
                  <img
                    src={detalhe.gif_url}
                    alt={`Demonstração de execução: ${detalhe.nome}`}
                    className="w-full rounded-lg border border-border"
                  />
                )}

                {detalhe.video_url && (
                  <a
                    href={detalhe.video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <PlayCircle className="h-4 w-4" /> Ver vídeo de execução
                  </a>
                )}

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <Label className="text-sm">Disponível para novas fichas</Label>
                  <Switch checked={detalhe.ativo} onCheckedChange={() => alternarAtivo.mutate(detalhe)} />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar exercício padrão" : "Novo exercício padrão"}</DialogTitle>
            <DialogDescription>
              Fica disponível para todas as academias da plataforma que ainda não tiverem uma cópia própria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Grupo muscular</Label>
                <Select value={form.grupo_muscular} onValueChange={(v) => setForm((f) => ({ ...f, grupo_muscular: v as (typeof GRUPOS_MUSCULARES)[number] }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRUPOS_MUSCULARES.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Vídeo ou link do YouTube (opcional)</Label>
                <Input value={form.video_url} onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))} placeholder="https://..." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>GIF de execução (opcional)</Label>
              <Input value={form.gif_url} onChange={(e) => setForm((f) => ({ ...f, gif_url: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição de como executar (opcional)</Label>
              <Textarea
                value={form.descricao_execucao}
                onChange={(e) => setForm((f) => ({ ...f, descricao_execucao: e.target.value }))}
                placeholder="Ex.: Mantenha as costas retas, desça até 90 graus e evite travar os joelhos no topo do movimento."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Séries</Label>
                <Input inputMode="numeric" value={form.series_padrao} onChange={(e) => setForm((f) => ({ ...f, series_padrao: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Repetições</Label>
                <Input value={form.repeticoes_padrao} onChange={(e) => setForm((f) => ({ ...f, repeticoes_padrao: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Descanso (seg)</Label>
                <Input inputMode="numeric" value={form.descanso_padrao_seg} onChange={(e) => setForm((f) => ({ ...f, descanso_padrao_seg: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!excluir} onOpenChange={(open) => !open && setExcluir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir exercício padrão?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso remove "{excluir?.nome}" do catálogo compartilhado com todas as academias. Academias que já
            criaram cópia própria não são afetadas. Fichas-modelo e treinos já publicados continuam intactos (guardam
            o nome, não uma referência). Não pode ser desfeito.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={excluirExercicio.isPending} onClick={() => excluirExercicio.mutate()}>
              {excluirExercicio.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
