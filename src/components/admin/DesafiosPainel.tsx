import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todasAsLinhas } from "@/lib/paginar";
import { perfisDosUsuarios } from "@/lib/perfis";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Pencil, Users } from "lucide-react";
import { DESAFIO_TIPO_LABEL, type DesafioTipo } from "@/lib/desafioProgresso";
import type { Tables } from "@/integrations/supabase/types";
import { formatarDataBR } from "@/lib/dataBrasilia";

type Desafio = Tables<"desafios">;

interface AlunoOpcao {
  id: string;
  nome: string;
}

const TIPOS: DesafioTipo[] = ["sem_doce", "sem_alcool", "consumo_agua", "numero_treinos", "modalidades", "desempenho_dieta", "livre"];

interface FormState {
  titulo: string;
  descricao: string;
  tipo: DesafioTipo;
  metaValor: string;
  dataInicio: string;
  dataFim: string;
  pontos: string;
  paraTodos: boolean;
  selecionados: string[];
}

const FORM_INICIAL: FormState = {
  titulo: "",
  descricao: "",
  tipo: "livre",
  metaValor: "",
  dataInicio: "",
  dataFim: "",
  pontos: "10",
  paraTodos: true,
  selecionados: [],
};

export function DesafiosPainel() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<"todos" | "manuais">("todos");
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<Desafio | null>(null);
  const [form, setForm] = useState<FormState>(FORM_INICIAL);
  const [excluir, setExcluir] = useState<Desafio | null>(null);

  const { data: desafios = [], isLoading } = useQuery({
    queryKey: ["admin-desafios", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("desafios")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("data_inicio", { ascending: false });
      if (error) throw error;
      return data as Desafio[];
    },
    enabled: !!organization?.id,
  });

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-desafios-alunos", organization?.id],
    queryFn: async () => {
      const alunosData = await todasAsLinhas((de, ate) =>
        supabase.from("alunos").select("id, user_id").eq("organization_id", organization!.id).order("id").range(de, ate)
      );
      const perfis = await perfisDosUsuarios(alunosData.map((a) => a.user_id));
      return alunosData.map((a) => ({ id: a.id, nome: perfis.get(a.user_id)?.full_name ?? "—" })) as AlunoOpcao[];
    },
    enabled: !!organization?.id,
  });

  const { data: participantesPorDesafio = {} } = useQuery({
    queryKey: ["admin-desafios-participantes", desafios.map((d) => d.id).join(",")],
    queryFn: async () => {
      if (desafios.length === 0) return {};
      const data = await todasAsLinhas((de, ate) =>
        supabase
          .from("desafio_participantes")
          .select("desafio_id, aluno_id")
          .in("desafio_id", desafios.map((d) => d.id))
          .order("id")
          .range(de, ate)
      );
      const map: Record<string, string[]> = {};
      data.forEach((p) => {
        map[p.desafio_id] = [...(map[p.desafio_id] ?? []), p.aluno_id];
      });
      return map;
    },
    enabled: desafios.length > 0,
  });

  const { data: progressoPorDesafio = {} } = useQuery({
    queryKey: ["admin-desafios-progresso", desafios.map((d) => d.id).join(",")],
    queryFn: async () => {
      if (desafios.length === 0) return {};
      const data = await todasAsLinhas((de, ate) =>
        supabase
          .from("desafio_progresso")
          .select("desafio_id, aluno_id, concluido")
          .in("desafio_id", desafios.map((d) => d.id))
          .order("id")
          .range(de, ate)
      );
      const map: Record<string, Record<string, boolean>> = {};
      data.forEach((p) => {
        map[p.desafio_id] = { ...(map[p.desafio_id] ?? {}), [p.aluno_id]: p.concluido };
      });
      return map;
    },
    enabled: desafios.length > 0,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Organização inválida");
      const payload = {
        organization_id: organization.id,
        titulo: form.titulo.trim(),
        descricao: form.descricao.trim() || null,
        tipo: form.tipo,
        meta_valor: form.tipo !== "livre" && form.metaValor.trim() ? Number(form.metaValor) : null,
        data_inicio: form.dataInicio,
        data_fim: form.dataFim,
        pontos: Number(form.pontos) || 10,
        para_todos: form.paraTodos,
      };

      let desafioId: string;
      if (editando) {
        const { error } = await supabase.from("desafios").update(payload).eq("id", editando.id);
        if (error) throw error;
        desafioId = editando.id;
      } else {
        const { data, error } = await supabase.from("desafios").insert(payload).select("id").single();
        if (error) throw error;
        desafioId = data.id;
      }

      if (!form.paraTodos) {
        await supabase.from("desafio_participantes").delete().eq("desafio_id", desafioId);
        if (form.selecionados.length > 0) {
          const { error } = await supabase.from("desafio_participantes").insert(
            form.selecionados.map((alunoId) => ({ organization_id: organization.id, desafio_id: desafioId, aluno_id: alunoId }))
          );
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast({ title: editando ? "Desafio atualizado!" : "Desafio criado!" });
      void queryClient.invalidateQueries({ queryKey: ["admin-desafios", organization?.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-desafios-participantes"] });
      fecharDialog();
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar desafio", description: error.message, variant: "destructive" }),
  });

  const excluirDesafio = useMutation({
    mutationFn: async () => {
      if (!excluir) return;
      const { error } = await supabase.from("desafios").delete().eq("id", excluir.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Desafio excluído" });
      void queryClient.invalidateQueries({ queryKey: ["admin-desafios", organization?.id] });
      setExcluir(null);
    },
    onError: (error: Error) => toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }),
  });

  const toggleProgresso = useMutation({
    mutationFn: async ({ desafioId, alunoId, concluido }: { desafioId: string; alunoId: string; concluido: boolean }) => {
      if (!organization) throw new Error("Organização inválida");
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("desafio_progresso").upsert(
        {
          organization_id: organization.id,
          desafio_id: desafioId,
          aluno_id: alunoId,
          concluido,
          concluido_por: auth.user?.id ?? null,
          concluido_em: concluido ? new Date().toISOString() : null,
        },
        { onConflict: "desafio_id,aluno_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-desafios-progresso"] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar progresso", description: error.message, variant: "destructive" }),
  });

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setDialogAberto(true);
  };

  const abrirEdicao = (d: Desafio) => {
    setEditando(d);
    setForm({
      titulo: d.titulo,
      descricao: d.descricao ?? "",
      tipo: d.tipo,
      metaValor: d.meta_valor != null ? String(d.meta_valor) : "",
      dataInicio: d.data_inicio,
      dataFim: d.data_fim,
      pontos: String(d.pontos),
      paraTodos: d.para_todos,
      selecionados: participantesPorDesafio[d.id] ?? [],
    });
    setDialogAberto(true);
  };

  const fecharDialog = () => {
    setDialogAberto(false);
    setEditando(null);
    setForm(FORM_INICIAL);
  };

  const toggleSelecionado = (alunoId: string) => {
    setForm((f) => ({
      ...f,
      selecionados: f.selecionados.includes(alunoId) ? f.selecionados.filter((id) => id !== alunoId) : [...f.selecionados, alunoId],
    }));
  };

  const desafiosFiltrados = filtro === "manuais" ? desafios.filter((d) => d.tipo === "livre") : desafios;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={abrirNovo}>
          <Plus className="h-4 w-4 mr-1.5" /> Novo Desafio
        </Button>
      </div>

      <Tabs value={filtro} onValueChange={(v) => setFiltro(v as "todos" | "manuais")}>
        <TabsList>
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="manuais">Manuais</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!isLoading && desafiosFiltrados.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhum desafio ainda.</CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {desafiosFiltrados.map((d) => {
          const ativo = new Date(d.data_fim) >= new Date();
          const participantes = d.para_todos ? alunos : alunos.filter((a) => (participantesPorDesafio[d.id] ?? []).includes(a.id));
          const progresso = progressoPorDesafio[d.id] ?? {};
          const concluidos = Object.values(progresso).filter(Boolean).length;
          const info = DESAFIO_TIPO_LABEL[d.tipo];
          return (
            <Card key={d.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold flex items-center gap-1.5">
                      {info.emoji} {d.titulo}
                    </p>
                    {d.descricao && <p className="text-xs text-muted-foreground">{d.descricao}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEdicao(d)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setExcluir(d)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={ativo ? "default" : "secondary"}>{ativo ? "Ativo" : "Encerrado"}</Badge>
                  <Badge variant="outline">{d.tipo === "livre" ? "Manual" : "Automático"}</Badge>
                  <Badge variant="outline">{d.pontos} pts</Badge>
                  <Badge variant="outline">
                    <Users className="h-3 w-3 mr-1" /> {d.para_todos ? "Todos" : "Selecionados"}
                  </Badge>
                  <Badge variant="outline">
                    {formatarDataBR(d.data_inicio)} - {formatarDataBR(d.data_fim)}
                  </Badge>
                  <Badge variant="secondary">{concluidos} concluídos</Badge>
                </div>

                {d.tipo === "livre" && (
                  <div className="border-t border-border pt-2 mt-1 space-y-1 max-h-48 overflow-y-auto">
                    {participantes.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                        <Checkbox
                          checked={!!progresso[a.id]}
                          onCheckedChange={(v) => toggleProgresso.mutate({ desafioId: d.id, alunoId: a.id, concluido: v === true })}
                        />
                        {a.nome}
                      </label>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={dialogAberto} onOpenChange={(open) => !open && fecharDialog()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Desafio" : "Novo Desafio"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={(v) => {
                  const tipo = v as DesafioTipo;
                  setForm((f) => ({ ...f, tipo, titulo: f.titulo || DESAFIO_TIPO_LABEL[tipo].label }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {DESAFIO_TIPO_LABEL[t].emoji} {DESAFIO_TIPO_LABEL[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={2} />
            </div>
            {form.tipo !== "livre" && (
              <div className="space-y-1.5">
                <Label>Meta ({DESAFIO_TIPO_LABEL[form.tipo].unidade})</Label>
                <Input type="number" value={form.metaValor} onChange={(e) => setForm((f) => ({ ...f, metaValor: e.target.value }))} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data início</Label>
                <Input type="date" value={form.dataInicio} onChange={(e) => setForm((f) => ({ ...f, dataInicio: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Data fim</Label>
                <Input type="date" value={form.dataFim} onChange={(e) => setForm((f) => ({ ...f, dataFim: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Pontos</Label>
              <Input type="number" value={form.pontos} onChange={(e) => setForm((f) => ({ ...f, pontos: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <Label>Para todos os alunos</Label>
              <Switch checked={form.paraTodos} onCheckedChange={(v) => setForm((f) => ({ ...f, paraTodos: v }))} />
            </div>
            {!form.paraTodos && (
              <div className="space-y-1.5">
                <Label>Alunos selecionados ({form.selecionados.length})</Label>
                <div className="max-h-40 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
                  {alunos.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                      <Checkbox checked={form.selecionados.includes(a.id)} onCheckedChange={() => toggleSelecionado(a.id)} />
                      {a.nome}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={fecharDialog}>
              Cancelar
            </Button>
            <Button
              disabled={!form.titulo.trim() || !form.dataInicio || !form.dataFim || salvar.isPending}
              onClick={() => salvar.mutate()}
            >
              {salvar.isPending ? "Salvando..." : editando ? "Salvar alterações" : "Criar desafio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!excluir} onOpenChange={(open) => !open && setExcluir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir desafio?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso remove "{excluir?.titulo}" e todo o progresso registrado nele. Não pode ser desfeito.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={excluirDesafio.isPending} onClick={() => excluirDesafio.mutate()}>
              {excluirDesafio.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
