import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UtensilsCrossed, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_DIETA_LABEL: Record<string, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  concluido: "Concluído",
};

export default function AdminDietas() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const alunoIdFromNav = (location.state as { alunoId?: string } | null)?.alunoId;

  const [novoModeloTitulo, setNovoModeloTitulo] = useState("");
  const [modeloSelecionado, setModeloSelecionado] = useState<string | null>(null);
  const [novaRefeicao, setNovaRefeicao] = useState({ nome_refeicao: "", horario_sugerido: "", itens: "" });

  const [abaAtiva, setAbaAtiva] = useState(alunoIdFromNav ? "publicar" : "biblioteca");
  const [alunoPublicar, setAlunoPublicar] = useState<string>(alunoIdFromNav ?? "");
  const [modeloPublicar, setModeloPublicar] = useState<string>("");
  const [tituloPublicar, setTituloPublicar] = useState("");

  useEffect(() => {
    if (alunoIdFromNav) {
      setAlunoPublicar(alunoIdFromNav);
      setAbaAtiva("publicar");
    }
  }, [alunoIdFromNav]);

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-dieta", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos_dieta")
        .select("id, titulo")
        .eq("organization_id", organization!.id)
        .order("titulo");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: refeicoes = [] } = useQuery({
    queryKey: ["modelo-dieta-refeicoes", modeloSelecionado],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_dieta_refeicoes")
        .select("*")
        .eq("modelo_id", modeloSelecionado!)
        .order("ordem");
      if (error) throw error;
      return data;
    },
    enabled: !!modeloSelecionado,
  });

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-alunos-select-dieta", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select("id, user_id, nivel_atacado")
        .eq("organization_id", organization!.id)
        .in("nivel_atacado", ["integrado", "elite"]);
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
    queryKey: ["dietas-historico", alunoPublicar],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dietas")
        .select("id, titulo, status, versao_id, created_at")
        .eq("aluno_id", alunoPublicar)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!alunoPublicar,
  });

  const criarModelo = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Organização não encontrada");
      const { data, error } = await supabase
        .from("modelos_dieta")
        .insert({ organization_id: organization.id, titulo: novoModeloTitulo })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      setNovoModeloTitulo("");
      setModeloSelecionado(id);
      void queryClient.invalidateQueries({ queryKey: ["modelos-dieta", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao criar modelo", description: error.message, variant: "destructive" }),
  });

  const adicionarRefeicao = useMutation({
    mutationFn: async () => {
      if (!modeloSelecionado) throw new Error("Selecione um modelo");
      const { error } = await supabase.from("modelo_dieta_refeicoes").insert({
        modelo_id: modeloSelecionado,
        ordem: refeicoes.length,
        nome_refeicao: novaRefeicao.nome_refeicao,
        horario_sugerido: novaRefeicao.horario_sugerido || null,
        itens: novaRefeicao.itens || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovaRefeicao({ nome_refeicao: "", horario_sugerido: "", itens: "" });
      void queryClient.invalidateQueries({ queryKey: ["modelo-dieta-refeicoes", modeloSelecionado] });
    },
    onError: (error: Error) => toast({ title: "Erro ao adicionar refeição", description: error.message, variant: "destructive" }),
  });

  const removerRefeicao = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("modelo_dieta_refeicoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["modelo-dieta-refeicoes", modeloSelecionado] }),
  });

  const publicar = useMutation({
    mutationFn: async () => {
      if (!alunoPublicar || !modeloPublicar || !tituloPublicar) throw new Error("Preencha aluno, modelo e título");
      const { error } = await supabase.rpc("publicar_dieta", {
        _aluno_id: alunoPublicar,
        _modelo_id: modeloPublicar,
        _titulo: tituloPublicar,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Dieta publicada!", description: "O snapshot foi congelado e já está disponível para o aluno." });
      setTituloPublicar("");
      void queryClient.invalidateQueries({ queryKey: ["dietas-historico", alunoPublicar] });
    },
    onError: (error: Error) => toast({ title: "Erro ao publicar", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Dietas</h1>
      </div>
      <p className="text-xs text-muted-foreground">
        Disponível apenas para alunos nos níveis Integrado ou Elite (o nível Essencial não inclui nutrição).
      </p>

      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <TabsList>
          <TabsTrigger value="biblioteca">Biblioteca de Modelos</TabsTrigger>
          <TabsTrigger value="publicar">Publicar para Aluno</TabsTrigger>
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
                <CardTitle className="text-base">Refeições</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Refeição</TableHead>
                      <TableHead>Horário</TableHead>
                      <TableHead>Itens</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {refeicoes.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.nome_refeicao}</TableCell>
                        <TableCell>{r.horario_sugerido ?? "—"}</TableCell>
                        <TableCell className="max-w-xs truncate">{r.itens ?? "—"}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removerRefeicao.mutate(r.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border">
                  <Input
                    placeholder="Nome da refeição (ex.: Café da manhã)"
                    value={novaRefeicao.nome_refeicao}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, nome_refeicao: e.target.value }))}
                  />
                  <Input
                    type="time"
                    value={novaRefeicao.horario_sugerido}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, horario_sugerido: e.target.value }))}
                  />
                  <Textarea
                    className="sm:col-span-2"
                    placeholder="Itens da refeição"
                    value={novaRefeicao.itens}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, itens: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!novaRefeicao.nome_refeicao.trim() || adicionarRefeicao.isPending}
                  onClick={() => adicionarRefeicao.mutate()}
                >
                  <Plus className="h-4 w-4 mr-1" /> Adicionar refeição
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="publicar">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Publicar dieta</CardTitle>
              <p className="text-xs text-muted-foreground">
                Cria uma cópia congelada (snapshot) do modelo para o aluno. Só aparecem alunos Integrado/Elite.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Aluno</Label>
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
                <Select value={modeloPublicar} onValueChange={setModeloPublicar}>
                  <SelectTrigger><SelectValue placeholder="Selecione o modelo" /></SelectTrigger>
                  <SelectContent>
                    {modelos.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.titulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Título da dieta publicada</Label>
                <Input value={tituloPublicar} onChange={(e) => setTituloPublicar(e.target.value)} placeholder="Ex.: Plano Alimentar — Fase 1" />
              </div>
              <Button disabled={publicar.isPending} onClick={() => publicar.mutate()}>
                Publicar dieta
              </Button>
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
                  <p className="text-sm text-muted-foreground">Nenhuma dieta publicada para este aluno ainda.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Título</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Publicado em</TableHead>
                        <TableHead>Versão</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historico.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>{h.titulo}</TableCell>
                          <TableCell>
                            <Badge variant={h.status === "ativo" ? "default" : "outline"}>
                              {STATUS_DIETA_LABEL[h.status ?? ""] ?? h.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{new Date(h.created_at).toLocaleDateString("pt-BR")}</TableCell>
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
      </Tabs>
    </div>
  );
}
