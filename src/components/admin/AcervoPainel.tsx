import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { porLotes, todasAsLinhas } from "@/lib/paginar";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ArrowLeftRight, Globe, Copy } from "lucide-react";
import { useListasAcervo } from "@/hooks/useListasAcervo";
import { SeletorGrupos } from "@/components/acervo/SeletorGrupos";
import { CampoMidia } from "@/components/acervo/CampoMidia";
import { MidiaExercicio, MiniaturaExercicio } from "@/components/acervo/MidiaExercicio";
import type { Tables } from "@/integrations/supabase/types";

type ExercicioBiblioteca = Tables<"exercicios_biblioteca">;

const FORM_VAZIO = {
  id: "",
  origemPadraoId: "", // quando preenchido, salvar cria uma cópia da academia em vez de editar o padrão ArkeFit
  nome: "",
  grupos: [] as string[],
  equipamento: "",
  series_padrao: "3",
  repeticoes_padrao: "12",
  descanso_padrao_seg: "60",
  video_url: "",
  descricao_execucao: "",
  gif_url: "",
};

export function AcervoPainel() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const { grupos: gruposDisponiveis, equipamentos } = useListasAcervo();
  const [busca, setBusca] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("todos");
  const [filtroEquipamento, setFiltroEquipamento] = useState("todos");
  const queryClient = useQueryClient();
  const [dialogAberto, setDialogAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<ExercicioBiblioteca | null>(null);

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
      if (form.grupos.length === 0) throw new Error("Marque pelo menos um grupo muscular.");
      const payload = {
        nome: form.nome.trim(),
        // O grupo principal é o primeiro da lista (o banco confere e mantém assim).
        grupo_muscular: form.grupos[0],
        grupos_musculares: form.grupos,
        equipamento: form.equipamento || null,
        series_padrao: Number(form.series_padrao) || 3,
        repeticoes_padrao: form.repeticoes_padrao.trim() || "12",
        descanso_padrao_seg: Number(form.descanso_padrao_seg) || 60,
        video_url: form.video_url.trim() || null,
        descricao_execucao: form.descricao_execucao.trim() || null,
        gif_url: form.gif_url.trim() || null,
      };
      // Editando um exercício próprio da academia: atualiza no lugar.
      // Editando (ou clonando) um Padrão ArkeFit: nunca altera a linha
      // global compartilhada com as outras academias — sempre cria uma
      // cópia da própria organização, já com as mudanças aplicadas.
      if (form.id && !form.origemPadraoId) {
        const { error } = await supabase.from("exercicios_biblioteca").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("exercicios_biblioteca")
          .insert({ ...payload, organization_id: organization.id, origem: form.origemPadraoId ? "copiado_do_padrao" : "importado" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: form.origemPadraoId ? "Cópia da academia criada" : form.id ? "Exercício atualizado" : "Exercício adicionado" });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-acervo", organization?.id] });
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
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-acervo", organization?.id] });
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
      toast({ title: "Exercício excluído" });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca-acervo", organization?.id] });
      void queryClient.invalidateQueries({ queryKey: ["exercicios-biblioteca"] });
      setExcluir(null);
      setDetalheId(null);
    },
    onError: (error: Error) => toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }),
  });

  const abrirEdicao = (ex: ExercicioBiblioteca) => {
    const ehPadrao = ex.organization_id === null;
    setForm({
      id: ex.id,
      origemPadraoId: ehPadrao ? ex.id : "",
      nome: ex.nome,
      grupos: ex.grupos_musculares?.length ? ex.grupos_musculares : ex.grupo_muscular ? [ex.grupo_muscular] : [],
      equipamento: ex.equipamento ?? "",
      series_padrao: String(ex.series_padrao),
      repeticoes_padrao: ex.repeticoes_padrao,
      descanso_padrao_seg: String(ex.descanso_padrao_seg),
      video_url: ex.video_url ?? "",
      descricao_execucao: ex.descricao_execucao ?? "",
      gif_url: ex.gif_url ?? "",
    });
    setDialogAberto(true);
  };

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const passaFiltro = (e: ExercicioBiblioteca) =>
    (!termo || e.nome.toLocaleLowerCase("pt-BR").includes(termo)) &&
    (filtroGrupo === "todos" || (e.grupos_musculares?.length ? e.grupos_musculares : [e.grupo_muscular]).includes(filtroGrupo)) &&
    (filtroEquipamento === "todos" || e.equipamento === filtroEquipamento);
  const exerciciosDaOrg = exercicios.filter((e) => e.organization_id === organization?.id && passaFiltro(e));
  const exerciciosPadrao = exercicios.filter((e) => e.organization_id === null && passaFiltro(e));
  const gruposDoExercicio = (e: ExercicioBiblioteca) => (e.grupos_musculares?.length ? e.grupos_musculares : [e.grupo_muscular]).join(", ");
  const detalhe = exercicios.find((e) => e.id === detalheId) ?? null;
  const detalheEhDaOrg = !!detalhe && detalhe.organization_id === organization?.id;

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
        const itensAntigos = await porLotes(modeloIds, (lote) =>
          todasAsLinhas((de, ate) =>
            supabase.from("modelo_treino_exercicios").select("id, nome_exercicio").in("modelo_id", lote).order("id").range(de, ate)
          )
        );
        const idsParaAtualizar = itensAntigos
          .filter((i) => i.nome_exercicio.trim().toLowerCase() === nomeAntigoNormalizado)
          .map((i) => i.id);
        if (idsParaAtualizar.length > 0) {
          await porLotes(idsParaAtualizar, (lote) =>
            supabase
              .from("modelo_treino_exercicios")
              .update({ nome_exercicio: novo.nome, grupo_muscular: [novo.grupo_muscular] })
              .in("id", lote)
          );
          fichasAtualizadas = idsParaAtualizar.length;
        }
      }

      // 2) Treinos ativos publicados (snapshot já congelado) — reescreve o item no JSON.
      const treinosAtivos = await todasAsLinhas((de, ate) =>
        supabase
          .from("treinos")
          .select("id, snapshot_conteudo")
          .eq("organization_id", organization.id)
          .eq("status", "ativo")
          .order("id")
          .range(de, ate)
      );

      let treinosAtualizados = 0;
      for (const treino of treinosAtivos) {
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Biblioteca de exercícios usada nas fichas de treino — combina os padrões do ArkeFit (compartilhados com
        todas as academias) com os exercícios próprios da academia. Clique em qualquer exercício para editar, adicionar
        vídeo/GIF de execução e descrição — as mudanças aparecem para os alunos no app.
      </p>

      <Tabs defaultValue="biblioteca">
        <TabsList>
          <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger>
          <TabsTrigger value="de-para">De-Para (migração em lote)</TabsTrigger>
        </TabsList>

        <TabsContent value="biblioteca" className="space-y-4 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Input className="max-w-xs" placeholder="Buscar pelo nome" aria-label="Buscar exercício pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <Select value={filtroGrupo} onValueChange={setFiltroGrupo}>
              <SelectTrigger className="w-[170px]" aria-label="Filtrar por grupo muscular">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os grupos</SelectItem>
                {gruposDisponiveis.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroEquipamento} onValueChange={setFiltroEquipamento}>
              <SelectTrigger className="w-[170px]" aria-label="Filtrar por equipamento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os equipamentos</SelectItem>
                {equipamentos.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex-1" />
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
              <CardDescription>Só você gerencia estes — específicos da sua organização. Clique no nome para ver o detalhe completo.</CardDescription>
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
                      <TableHead className="w-14" />
                      <TableHead>Nome</TableHead>
                      <TableHead>Grupo</TableHead>
                      <TableHead>Equipamento</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exerciciosDaOrg.map((ex) => (
                      <TableRow key={ex.id} className="cursor-pointer" onClick={() => setDetalheId(ex.id)}>
                        <TableCell>
                          <MiniaturaExercicio imagemUrl={ex.gif_url} videoUrl={ex.video_url} nome={ex.nome} />
                        </TableCell>
                        <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{ex.nome}</TableCell>
                        <TableCell>{gruposDoExercicio(ex)}</TableCell>
                        <TableCell>{ex.equipamento ?? "—"}</TableCell>
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Padrão ArkeFit ({exerciciosPadrao.length})
              </CardTitle>
              <CardDescription>
                Compartilhados com todas as academias. Clique para ver o detalhe — editar cria uma cópia só da sua
                academia, sem afetar as outras.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14" />
                    <TableHead>Nome</TableHead>
                    <TableHead>Grupo</TableHead>
                    <TableHead>Equipamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exerciciosPadrao.map((ex) => (
                    <TableRow key={ex.id} className="cursor-pointer" onClick={() => setDetalheId(ex.id)}>
                      <TableCell>
                        <MiniaturaExercicio imagemUrl={ex.gif_url} videoUrl={ex.video_url} nome={ex.nome} />
                      </TableCell>
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{ex.nome}</TableCell>
                      <TableCell>{gruposDoExercicio(ex)}</TableCell>
                      <TableCell>{ex.equipamento ?? "—"}</TableCell>
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

      {/* Detalhe do exercício — clique no nome na lista abre este painel. */}
      <Sheet open={!!detalheId} onOpenChange={(open) => !open && setDetalheId(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {detalhe && (
            <>
              <SheetHeader className="text-left">
                <div className="flex items-start justify-between gap-2">
                  <SheetTitle>{detalhe.nome}</SheetTitle>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEdicao(detalhe)} title={detalheEhDaOrg ? "Editar" : "Editar (cria cópia da academia)"}>
                      {detalheEhDaOrg ? <Pencil className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    {detalheEhDaOrg && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setExcluir(detalhe)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {(detalhe.grupos_musculares?.length ? detalhe.grupos_musculares : [detalhe.grupo_muscular]).map((g) => (
                    <Badge key={g} variant="outline">
                      {g}
                    </Badge>
                  ))}
                  {detalhe.equipamento && <Badge variant="secondary">{detalhe.equipamento}</Badge>}
                  {detalheEhDaOrg ? (
                    <Badge variant={detalhe.ativo ? "default" : "secondary"}>{detalhe.ativo ? "Ativo" : "Inativo"}</Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <Globe className="h-3 w-3" /> Padrão ArkeFit
                    </Badge>
                  )}
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

                <MidiaExercicio videoUrl={detalhe.video_url} imagemUrl={detalhe.gif_url} nome={detalhe.nome} />

                {!detalheEhDaOrg && (
                  <p className="text-xs text-muted-foreground">
                    Este é um exercício padrão ArkeFit, compartilhado com todas as academias. Para editar, clique no
                    ícone de cópia acima — isso cria uma versão só da sua academia, já com suas mudanças.
                  </p>
                )}

                {detalheEhDaOrg && (
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <Label className="text-sm">Disponível para novas fichas</Label>
                    <Switch checked={detalhe.ativo} onCheckedChange={() => alternarAtivo.mutate(detalhe)} />
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.origemPadraoId ? "Criar cópia da academia" : form.id ? "Editar exercício" : "Novo exercício da academia"}
            </DialogTitle>
            <DialogDescription>
              {form.origemPadraoId
                ? "Este é um Padrão ArkeFit — salvar cria uma cópia editável só da sua academia, sem alterar o exercício das outras."
                : "Fica disponível só na sua organização."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Grupos musculares</Label>
              <SeletorGrupos opcoes={gruposDisponiveis} valor={form.grupos} onChange={(grupos) => setForm((f) => ({ ...f, grupos }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Equipamento</Label>
              <Select value={form.equipamento || "nenhum"} onValueChange={(v) => setForm((f) => ({ ...f, equipamento: v === "nenhum" ? "" : v }))}>
                <SelectTrigger aria-label="Equipamento">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Sem equipamento definido</SelectItem>
                  {equipamentos.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vídeo e imagem de execução</Label>
              {organization && (
                <CampoMidia
                  pasta={organization.id}
                  videoUrl={form.video_url}
                  imagemUrl={form.gif_url}
                  nome={form.nome}
                  onChange={(m) => setForm((f) => ({ ...f, ...m }))}
                />
              )}
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
              {salvar.isPending ? "Salvando..." : form.origemPadraoId ? "Criar cópia" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!excluir} onOpenChange={(open) => !open && setExcluir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir exercício?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso remove "{excluir?.nome}" da biblioteca. Fichas-modelo e treinos já publicados que citam esse
            exercício continuam intactos (guardam o nome, não uma referência) — só deixa de aparecer nas
            próximas prescrições. Não pode ser desfeito.
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
