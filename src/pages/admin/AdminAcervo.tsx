import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Dumbbell, Plus, Pencil, ArrowLeftRight, Lock } from "lucide-react";
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
};

export default function AdminAcervo() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogAberto, setDialogAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);

  const [nomeAntigo, setNomeAntigo] = useState("");
  const [novoExercicioId, setNovoExercicioId] = useState("");
  const [aplicando, setAplicando] = useState(false);

  const { data: exercicios = [], isLoading } = useQuery({
    queryKey: ["exercicios-biblioteca-acervo", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exercicios_biblioteca")
        .select("*")
        .order("grupo_muscular")
        .order("nome");
      if (error) throw error;
      return data as ExercicioBiblioteca[];
    },
    enabled: !!organization?.id,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!organization) return;
      if (!form.nome.trim()) throw new Error("Informe o nome do exercício.");
      const payload = {
        nome: form.nome.trim(),
        grupo_muscular: form.grupo_muscular,
        series_padrao: Number(form.series_padrao) || 3,
        repeticoes_padrao: form.repeticoes_padrao.trim() || "12",
        descanso_padrao_seg: Number(form.descanso_padrao_seg) || 60,
        video_url: form.video_url.trim() || null,
      };
      if (form.id) {
        const { error } = await supabase.from("exercicios_biblioteca").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("exercicios_biblioteca")
          .insert({ ...payload, organization_id: organization.id, origem: "importado" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: form.id ? "Exercício atualizado" : "Exercício adicionado" });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-acervo", organization?.id] });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca"] });
      setDialogAberto(false);
      setForm(FORM_VAZIO);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const alternarAtivo = useMutation({
    mutationFn: async (ex: ExercicioBiblioteca) => {
      const { error } = await supabase.from("exercicios_biblioteca").update({ ativo: !ex.ativo }).eq("id", ex.id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-acervo", organization?.id] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
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
    });
    setDialogAberto(true);
  };

  const exerciciosDaOrg = exercicios.filter((e) => e.organization_id === organization?.id);
  const exerciciosPadrao = exercicios.filter((e) => e.organization_id === null);

  const aplicarDePara = async () => {
    if (!organization || !nomeAntigo.trim() || !novoExercicioId) return;
    const novo = exercicios.find((e) => e.id === novoExercicioId);
    if (!novo) return;
    setAplicando(true);
    try {
      const nomeAntigoNormalizado = nomeAntigo.trim().toLowerCase();

      // 1) Fichas-modelo (modelos_treino) da organização — atualização direta.
      const { data: modelos } = await supabase.from("modelos_treino").select("id").eq("organization_id", organization.id);
      const modeloIds = (modelos ?? []).map((m) => m.id);
      let fichasAtualizadas = 0;
      if (modeloIds.length > 0) {
        const { data: itensAntigos } = await supabase
          .from("modelo_treino_exercicios")
          .select("id, nome_exercicio")
          .in("modelo_id", modeloIds);
        const idsParaAtualizar = (itensAntigos ?? [])
          .filter((i) => i.nome_exercicio.trim().toLowerCase() === nomeAntigoNormalizado)
          .map((i) => i.id);
        if (idsParaAtualizar.length > 0) {
          const { error } = await supabase
            .from("modelo_treino_exercicios")
            .update({ nome_exercicio: novo.nome, grupo_muscular: [novo.grupo_muscular] })
            .in("id", idsParaAtualizar);
          if (error) throw error;
          fichasAtualizadas = idsParaAtualizar.length;
        }
      }

      // 2) Treinos ativos publicados (snapshot já congelado) — reescreve o item no JSON.
      const { data: treinosAtivos } = await supabase
        .from("treinos")
        .select("id, snapshot_conteudo")
        .eq("organization_id", organization.id)
        .eq("status", "ativo");

      let treinosAtualizados = 0;
      for (const treino of treinosAtivos ?? []) {
        // grupo_muscular no snapshot é array (vem de modelo_treino_exercicios.grupo_muscular,
        // que é text[]) — mantém o mesmo formato ao reescrever.
        const conteudo = (treino.snapshot_conteudo as unknown as { nome_exercicio: string; grupo_muscular: string[] }[]) ?? [];
        let mudou = false;
        const novoConteudo = conteudo.map((item) => {
          if (item.nome_exercicio?.trim().toLowerCase() === nomeAntigoNormalizado) {
            mudou = true;
            return { ...item, nome_exercicio: novo.nome, grupo_muscular: [novo.grupo_muscular] };
          }
          return item;
        });
        if (mudou) {
          const { error } = await supabase
            .from("treinos")
            .update({ snapshot_conteudo: novoConteudo as never })
            .eq("id", treino.id);
          if (error) throw error;
          treinosAtualizados++;
        }
      }

      toast({
        title: "De-Para aplicado",
        description: `${fichasAtualizadas} exercício(s) em fichas-modelo e ${treinosAtualizados} treino(s) ativo(s) atualizados.`,
      });
      setNomeAntigo("");
      setNovoExercicioId("");
    } catch (error) {
      toast({ title: "Erro ao aplicar De-Para", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Acervo de Exercícios</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Biblioteca de exercícios usada nas fichas de treino — combina os padrões do ArkeFit (mantidos pela
        plataforma) com os exercícios próprios da academia (ex.: importados de um sistema antigo).
      </p>

      <Tabs defaultValue="biblioteca">
        <TabsList>
          <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger>
          <TabsTrigger value="de-para">De-Para (migração em lote)</TabsTrigger>
        </TabsList>

        <TabsContent value="biblioteca" className="space-y-4 pt-3">
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                setForm(FORM_VAZIO);
                setDialogAberto(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Novo exercício da academia
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Exercícios da academia ({exerciciosDaOrg.length})</CardTitle>
              <CardDescription>Só você gerencia estes — específicos da sua organização.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
              {!isLoading && exerciciosDaOrg.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">Nenhum exercício próprio cadastrado ainda.</p>
              )}
              {exerciciosDaOrg.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exerciciosDaOrg.map((ex) => (
                      <TableRow key={ex.id}>
                        <TableCell className="font-medium">{ex.nome}</TableCell>
                        <TableCell>{ex.grupo_muscular}</TableCell>
                        <TableCell>
                          <Badge variant={ex.ativo ? "default" : "secondary"}>{ex.ativo ? "Ativo" : "Inativo"}</Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEdicao(ex)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Switch checked={ex.ativo} onCheckedChange={() => alternarAtivo.mutate(ex)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Padrão ArkeFit ({exerciciosPadrao.length})
              </CardTitle>
              <CardDescription>Mantidos pela plataforma, disponíveis pra todas as academias.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Grupo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exerciciosPadrao.map((ex) => (
                    <TableRow key={ex.id}>
                      <TableCell className="font-medium">{ex.nome}</TableCell>
                      <TableCell>{ex.grupo_muscular}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="de-para" className="space-y-4 pt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-1.5">
                <ArrowLeftRight className="h-4 w-4" /> Mapear exercício antigo → ArkeFit
              </CardTitle>
              <CardDescription>
                Digite o nome exatamente como aparecia no sistema antigo e escolha o exercício correspondente no
                ArkeFit. Ao aplicar, atualiza sozinho todas as fichas-modelo e os treinos ativos dos alunos que
                usam esse nome — sem precisar editar aluno por aluno.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Nome antigo (como está hoje nas fichas)</Label>
                  <Input value={nomeAntigo} onChange={(e) => setNomeAntigo(e.target.value)} placeholder="Ex.: Supino reto c/ barra" />
                </div>
                <div className="space-y-1.5">
                  <Label>Exercício ArkeFit correspondente</Label>
                  <Select value={novoExercicioId} onValueChange={setNovoExercicioId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {exercicios.map((ex) => (
                        <SelectItem key={ex.id} value={ex.id}>
                          {ex.nome} ({ex.grupo_muscular})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={aplicarDePara} disabled={!nomeAntigo.trim() || !novoExercicioId || aplicando}>
                {aplicando ? "Aplicando..." : "Aplicar em lote"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar exercício" : "Novo exercício da academia"}</DialogTitle>
            <DialogDescription>Fica disponível só na sua organização.</DialogDescription>
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
                <Label>Vídeo (opcional)</Label>
                <Input value={form.video_url} onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))} placeholder="https://..." />
              </div>
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
    </div>
  );
}
