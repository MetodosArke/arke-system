import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRascunho } from "@/hooks/useRascunho";
import { chaveRascunho } from "@/lib/rascunho";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dumbbell, Plus, Trash2, FolderOpen, UserRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AcervoPainel } from "@/components/admin/AcervoPainel";

const STATUS_TREINO_LABEL: Record<string, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  concluido: "Concluído",
};

export default function AdminTreinos() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const alunoIdFromNav = (location.state as { alunoId?: string } | null)?.alunoId;

  const [novoModeloTitulo, setNovoModeloTitulo] = useState("");
  const [modeloSelecionado, setModeloSelecionado] = useState<string | null>(null);
  const [novoExercicio, setNovoExercicio] = useState({
    nome_exercicio: "",
    series: "3",
    repeticoes: "12",
    descanso_seg: "60",
    observacoes: "",
    video_url: "",
    descricao_execucao: "",
    gif_url: "",
  });
  const [exercicioBibliotecaId, setExercicioBibliotecaId] = useState("");

  // Rascunho do exercício em digitação.
  //
  // Os exercícios já adicionados estão no banco — só o que está sendo
  // escrito agora corre risco. Parece pouco, mas `descricao_execucao` é
  // onde o professor escreve a orientação de execução por extenso, e
  // reescrever um parágrafo é o tipo de perda que faz a pessoa abreviar na
  // segunda tentativa.
  //
  // A chave inclui o modelo: rascunho de uma ficha jamais aparece noutra.
  const { rascunhoDisponivel: exercicioSalvo, descartar: descartarExercicio } = useRascunho(
    modeloSelecionado ? chaveRascunho("treino-exercicio", modeloSelecionado) : null,
    novoExercicio,
    { ativo: !!novoExercicio.nome_exercicio || !!novoExercicio.descricao_execucao }
  );

  // Aqui restaurar é seguro sem perguntar: o campo está vazio, o rascunho é
  // do mesmo modelo e da mesma sessão. Não há dado de outra intenção para
  // sobrescrever.
  useEffect(() => {
    if (exercicioSalvo?.dados && !novoExercicio.nome_exercicio) {
      setNovoExercicio(exercicioSalvo.dados);
      descartarExercicio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercicioSalvo]);

  const { data: bibliotecaExercicios = [] } = useQuery({
    queryKey: ["exercicios-biblioteca"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exercicios_biblioteca")
        .select("id, nome, grupo_muscular, series_padrao, repeticoes_padrao, descanso_padrao_seg, video_url, descricao_execucao, gif_url")
        .order("grupo_muscular")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const aplicarExercicioBiblioteca = (id: string) => {
    setExercicioBibliotecaId(id);
    const item = bibliotecaExercicios.find((e) => e.id === id);
    if (!item) return;
    setNovoExercicio((p) => ({
      ...p,
      nome_exercicio: item.nome,
      series: String(item.series_padrao),
      repeticoes: item.repeticoes_padrao,
      descanso_seg: String(item.descanso_padrao_seg),
      video_url: item.video_url ?? "",
      descricao_execucao: item.descricao_execucao ?? "",
      gif_url: item.gif_url ?? "",
    }));
  };

  const [abaAtiva, setAbaAtiva] = useState(alunoIdFromNav ? "publicar" : "biblioteca");
  const [alunoPublicar, setAlunoPublicar] = useState<string>(alunoIdFromNav ?? "");
  const [modeloPublicar, setModeloPublicar] = useState<string>("");
  const [tituloPublicar, setTituloPublicar] = useState("");
  const [validadeFim, setValidadeFim] = useState("");
  const [modeloCarregadoId, setModeloCarregadoId] = useState<string | null>(null);
  const [perfilAberto, setPerfilAberto] = useState(false);

  useEffect(() => {
    if (alunoIdFromNav) {
      setAlunoPublicar(alunoIdFromNav);
      setAbaAtiva("publicar");
    }
  }, [alunoIdFromNav]);

  // Alterações ainda não salvas: rascunho de modelo/exercício não confirmado
  // ou seleção de publicação preenchida mas não enviada.
  const temAlteracoesNaoSalvas = useMemo(
    () =>
      novoModeloTitulo.trim() !== "" ||
      novoExercicio.nome_exercicio.trim() !== "" ||
      tituloPublicar.trim() !== "" ||
      validadeFim !== "",
    [novoModeloTitulo, novoExercicio.nome_exercicio, tituloPublicar, validadeFim]
  );

  const cancelar = () => {
    if (temAlteracoesNaoSalvas) {
      const confirmar = window.confirm(
        "Você tem alterações não salvas. Deseja realmente sair sem salvar?"
      );
      if (!confirmar) return;
    }
    navigate("/admin");
  };

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-treino", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos_treino")
        .select("id, titulo")
        .eq("organization_id", organization!.id)
        .order("titulo");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: exercicios = [] } = useQuery({
    queryKey: ["modelo-treino-exercicios", modeloSelecionado],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_treino_exercicios")
        .select("*")
        .eq("modelo_id", modeloSelecionado!)
        .order("ordem");
      if (error) throw error;
      return data;
    },
    enabled: !!modeloSelecionado,
  });

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-alunos-select", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select("id, user_id")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      const userIds = alunosData.map((a) => a.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return alunosData.map((a) => ({ id: a.id, nome: nomeByUserId.get(a.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  const { data: historico = [] } = useQuery({
    queryKey: ["treinos-historico", alunoPublicar],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treinos")
        .select("id, titulo, status, versao_id, validade_inicio, validade_fim, created_at")
        .eq("aluno_id", alunoPublicar)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!alunoPublicar,
  });

  const { data: exerciciosModeloCarregado = [] } = useQuery({
    queryKey: ["modelo-treino-exercicios-carregado", modeloCarregadoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_treino_exercicios")
        .select("*")
        .eq("modelo_id", modeloCarregadoId!)
        .order("ordem");
      if (error) throw error;
      return data;
    },
    enabled: !!modeloCarregadoId,
  });

  const { data: perfilAluno } = useQuery({
    queryKey: ["aluno-perfil-rapido", alunoPublicar],
    queryFn: async () => {
      const [{ data: alunoRow }, { data: anamneseRow }] = await Promise.all([
        supabase.from("alunos").select("objetivo").eq("id", alunoPublicar).maybeSingle(),
        supabase.from("anamnese_acolhimento").select("dores_lesoes").eq("aluno_id", alunoPublicar).maybeSingle(),
      ]);
      return {
        objetivo: alunoRow?.objetivo ?? null,
        doresLesoes: anamneseRow?.dores_lesoes ?? null,
      };
    },
    enabled: !!alunoPublicar && perfilAberto,
  });

  const ultimaFichaAtiva = historico.find((h) => h.status === "ativo") ?? null;

  const criarModelo = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Organização não encontrada");
      const { data, error } = await supabase
        .from("modelos_treino")
        .insert({ organization_id: organization.id, titulo: novoModeloTitulo })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      setNovoModeloTitulo("");
      setModeloSelecionado(id);
      void queryClient.invalidateQueries({ queryKey: ["modelos-treino", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao criar modelo", description: error.message, variant: "destructive" }),
  });

  const adicionarExercicio = useMutation({
    mutationFn: async () => {
      if (!modeloSelecionado) throw new Error("Selecione um modelo");
      const { error } = await supabase.from("modelo_treino_exercicios").insert({
        modelo_id: modeloSelecionado,
        ordem: exercicios.length,
        nome_exercicio: novoExercicio.nome_exercicio,
        series: Number(novoExercicio.series) || 3,
        repeticoes: novoExercicio.repeticoes,
        descanso_seg: Number(novoExercicio.descanso_seg) || 60,
        observacoes: novoExercicio.observacoes || null,
        video_url: novoExercicio.video_url || null,
        descricao_execucao: novoExercicio.descricao_execucao || null,
        gif_url: novoExercicio.gif_url || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovoExercicio({
        nome_exercicio: "",
        series: "3",
        repeticoes: "12",
        descanso_seg: "60",
        observacoes: "",
        video_url: "",
        descricao_execucao: "",
        gif_url: "",
      });
      setExercicioBibliotecaId("");
      descartarExercicio();
      void queryClient.invalidateQueries({ queryKey: ["modelo-treino-exercicios", modeloSelecionado] });
    },
    onError: (error: Error) => toast({ title: "Erro ao adicionar exercício", description: error.message, variant: "destructive" }),
  });

  const removerExercicio = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("modelo_treino_exercicios").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["modelo-treino-exercicios", modeloSelecionado] }),
  });

  const publicar = useMutation({
    mutationFn: async () => {
      if (!alunoPublicar || !modeloPublicar || !tituloPublicar) throw new Error("Preencha aluno, modelo e título");
      const { error } = await supabase.rpc("publicar_treino", {
        _aluno_id: alunoPublicar,
        _modelo_id: modeloPublicar,
        _titulo: tituloPublicar,
        _validade_fim: validadeFim || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Treino publicado!", description: "O snapshot foi congelado e já está disponível para o aluno." });
      setTituloPublicar("");
      setValidadeFim("");
      void queryClient.invalidateQueries({ queryKey: ["treinos-historico", alunoPublicar] });
      navigate("/admin");
    },
    onError: (error: Error) => toast({ title: "Erro ao publicar", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-20">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Treinos</h1>
      </div>

      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <TabsList>
          <TabsTrigger value="biblioteca">Biblioteca de Modelos</TabsTrigger>
          <TabsTrigger value="publicar">Publicar para Aluno</TabsTrigger>
          <TabsTrigger value="acervo">Acervo de Exercícios</TabsTrigger>
        </TabsList>

        <TabsContent value="biblioteca" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Novo modelo</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input placeholder="Título do modelo" value={novoModeloTitulo} onChange={(e) => setNovoModeloTitulo(e.target.value)} />
              <Button disabled={!novoModeloTitulo.trim() || criarModelo.isPending} onClick={() => criarModelo.mutate()}>
                <Plus className="h-4 w-4 mr-1" /> Criar
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            {modelos.map((m) => (
              <Button
                key={m.id}
                variant={modeloSelecionado === m.id ? "default" : "outline"}
                size="sm"
                onClick={() => setModeloSelecionado(m.id)}
              >
                {m.titulo}
              </Button>
            ))}
          </div>

          {modeloSelecionado && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Exercícios</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exercício</TableHead>
                      <TableHead>Séries</TableHead>
                      <TableHead>Repetições</TableHead>
                      <TableHead>Descanso (s)</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exercicios.map((ex) => (
                      <TableRow key={ex.id}>
                        <TableCell>{ex.nome_exercicio}</TableCell>
                        <TableCell>{ex.series}</TableCell>
                        <TableCell>{ex.repeticoes}</TableCell>
                        <TableCell>{ex.descanso_seg}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removerExercicio.mutate(ex.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="pt-2 border-t border-border space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Adicionar a partir da Biblioteca ARKE (opcional)</Label>
                  <Combobox
                    value={exercicioBibliotecaId}
                    onValueChange={aplicarExercicioBiblioteca}
                    placeholder="Buscar exercício na biblioteca..."
                    searchPlaceholder="Digite o nome do exercício ou grupo muscular..."
                    emptyText="Nenhum exercício encontrado."
                    options={bibliotecaExercicios.map((ex) => ({
                      value: ex.id,
                      label: `${ex.grupo_muscular} — ${ex.nome}`,
                    }))}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Input
                    className="col-span-2 sm:col-span-1"
                    placeholder="Nome do exercício"
                    value={novoExercicio.nome_exercicio}
                    onChange={(e) => setNovoExercicio((p) => ({ ...p, nome_exercicio: e.target.value }))}
                  />
                  <Input
                    placeholder="Séries"
                    value={novoExercicio.series}
                    onChange={(e) => setNovoExercicio((p) => ({ ...p, series: e.target.value }))}
                  />
                  <Input
                    placeholder="Repetições"
                    value={novoExercicio.repeticoes}
                    onChange={(e) => setNovoExercicio((p) => ({ ...p, repeticoes: e.target.value }))}
                  />
                  <Input
                    placeholder="Descanso (s)"
                    value={novoExercicio.descanso_seg}
                    onChange={(e) => setNovoExercicio((p) => ({ ...p, descanso_seg: e.target.value }))}
                  />
                  <Input
                    className="col-span-2 sm:col-span-2"
                    placeholder="Vídeo ou link do YouTube (opcional)"
                    value={novoExercicio.video_url}
                    onChange={(e) => setNovoExercicio((p) => ({ ...p, video_url: e.target.value }))}
                  />
                  <Input
                    className="col-span-2 sm:col-span-2"
                    placeholder="GIF de execução (opcional)"
                    value={novoExercicio.gif_url}
                    onChange={(e) => setNovoExercicio((p) => ({ ...p, gif_url: e.target.value }))}
                  />
                  <Input
                    className="col-span-2 sm:col-span-4"
                    placeholder="Como executar (opcional)"
                    value={novoExercicio.descricao_execucao}
                    onChange={(e) => setNovoExercicio((p) => ({ ...p, descricao_execucao: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!novoExercicio.nome_exercicio.trim() || adicionarExercicio.isPending}
                  onClick={() => adicionarExercicio.mutate()}
                >
                  <Plus className="h-4 w-4 mr-1" /> Adicionar exercício
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="publicar">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Publicar treino</CardTitle>
              <p className="text-xs text-muted-foreground">
                Cria uma cópia congelada (snapshot) do modelo para o aluno. Alterar o modelo depois não afeta o que já foi publicado.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Aluno</Label>
                  {alunoPublicar && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => setPerfilAberto(true)}>
                      <UserRound className="h-3.5 w-3.5 mr-1" />
                      Perfil Rápido
                    </Button>
                  )}
                </div>
                <Select value={alunoPublicar} onValueChange={setAlunoPublicar}>
                  <SelectTrigger><SelectValue placeholder="Selecione o aluno" /></SelectTrigger>
                  <SelectContent>
                    {alunos.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Modelo</Label>
                <div className="flex gap-2">
                  <Select
                    value={modeloPublicar}
                    onValueChange={(v) => {
                      setModeloPublicar(v);
                      setModeloCarregadoId(null);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione o modelo" /></SelectTrigger>
                    <SelectContent>
                      {modelos.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.titulo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!modeloPublicar}
                    onClick={() => setModeloCarregadoId(modeloPublicar)}
                  >
                    <FolderOpen className="h-4 w-4 mr-1" />
                    Carregar Modelo
                  </Button>
                </div>
              </div>

              {modeloCarregadoId && (
                <div className="space-y-1.5 pt-1 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground pt-2">Ficha carregada</p>
                  {exerciciosModeloCarregado.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Este modelo ainda não tem exercícios cadastrados.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Exercício</TableHead>
                          <TableHead>Séries</TableHead>
                          <TableHead>Repetições</TableHead>
                          <TableHead>Descanso (s)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {exerciciosModeloCarregado.map((ex) => (
                          <TableRow key={ex.id}>
                            <TableCell>{ex.nome_exercicio}</TableCell>
                            <TableCell>{ex.series}</TableCell>
                            <TableCell>{ex.repeticoes}</TableCell>
                            <TableCell>{ex.descanso_seg}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Título do treino publicado</Label>
                <Input value={tituloPublicar} onChange={(e) => setTituloPublicar(e.target.value)} placeholder="Ex.: Treino A — Adaptação" />
              </div>
              <div className="space-y-1.5">
                <Label>Validade até (opcional)</Label>
                <Input type="date" value={validadeFim} onChange={(e) => setValidadeFim(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {alunoPublicar && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Histórico de versões</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Cada publicação gera uma versão travada (snapshot imutável) — o histórico abaixo é só
                  para consulta e rastreabilidade; versões antigas não podem ser editadas.
                </p>
              </CardHeader>
              <CardContent>
                {historico.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum treino publicado para este aluno ainda.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Título</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Publicado em</TableHead>
                        <TableHead>Validade</TableHead>
                        <TableHead>Versão</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historico.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>{h.titulo}</TableCell>
                          <TableCell>
                            <Badge variant={h.status === "ativo" ? "default" : "outline"}>
                              {STATUS_TREINO_LABEL[h.status ?? ""] ?? h.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{new Date(h.created_at).toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell>
                            {h.validade_inicio ? new Date(h.validade_inicio).toLocaleDateString("pt-BR") : "—"}
                            {h.validade_fim ? ` até ${new Date(h.validade_fim).toLocaleDateString("pt-BR")}` : ""}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {h.versao_id.slice(0, 8)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="acervo">
          <AcervoPainel />
        </TabsContent>
      </Tabs>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-3xl mx-auto flex items-center justify-end gap-2 px-4 py-3">
          <Button variant="outline" onClick={cancelar}>
            Cancelar
          </Button>
          <Button
            className="gradient-primary text-primary-foreground font-semibold"
            disabled={!alunoPublicar || !modeloPublicar || !tituloPublicar || publicar.isPending}
            onClick={() => publicar.mutate()}
          >
            {publicar.isPending ? "Publicando..." : "Salvar e Publicar B.A.S.E.®"}
          </Button>
        </div>
      </div>

      <Sheet open={perfilAberto} onOpenChange={setPerfilAberto}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Perfil Rápido do Aluno</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Objetivo</p>
              <p className="text-sm">{perfilAluno?.objetivo || "Não informado"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Lesões / Restrições</p>
              <p className="text-sm whitespace-pre-wrap">{perfilAluno?.doresLesoes || "Nenhuma relatada"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Última Ficha Ativa</p>
              {ultimaFichaAtiva ? (
                <p className="text-sm">
                  {ultimaFichaAtiva.titulo} — publicada em{" "}
                  {new Date(ultimaFichaAtiva.created_at).toLocaleDateString("pt-BR")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum treino ativo publicado.</p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
