import { hojeBrasilia, formatarDataBR } from "@/lib/dataBrasilia";
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
import { Plus, Trash2, Pencil, Users, Crown } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { decimal } from "@/lib/numeros";

type Competicao = Tables<"competicoes">;
type Metrica = Tables<"competicoes">["metrica"];

const METRICA_LABEL: Record<Metrica, string> = {
  pontos_desafios: "Pontos em Desafios",
  treinos_concluidos: "Treinos Concluídos",
  km_total: "Quilometragem Total",
  dieta_adesao_media: "Média de Adesão à Dieta",
};

const METRICAS: Metrica[] = ["pontos_desafios", "treinos_concluidos", "km_total", "dieta_adesao_media"];

interface AlunoOpcao {
  id: string;
  nome: string;
}

interface FormState {
  titulo: string;
  descricao: string;
  dataInicio: string;
  dataFim: string;
  metrica: Metrica;
  paraTodos: boolean;
  selecionados: string[];
}

const FORM_INICIAL: FormState = {
  titulo: "",
  descricao: "",
  dataInicio: "",
  dataFim: "",
  metrica: "pontos_desafios",
  paraTodos: true,
  selecionados: [],
};

function RankingCompeticao({ competicaoId }: { competicaoId: string }) {
  const { data: ranking = [] } = useQuery({
    queryKey: ["ranking-competicao", competicaoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_ranking_competicao", { p_competicao_id: competicaoId });
      if (error) throw error;
      return data;
    },
  });

  if (ranking.length === 0) return <p className="text-xs text-muted-foreground">Sem dados ainda.</p>;

  return (
    <div className="space-y-1 border-t border-border pt-2 mt-1">
      {ranking.slice(0, 10).map((r, idx) => (
        <div key={r.aluno_id} className="flex items-center justify-between text-sm py-0.5">
          <div className="flex items-center gap-2">
            <Badge variant={idx === 0 ? "default" : "outline"} className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-[10px]">
              {idx === 0 ? <Crown className="h-3 w-3" /> : idx + 1}
            </Badge>
            <span>{r.nome}</span>
          </div>
          <span className="font-medium text-muted-foreground">{decimal(Number(r.valor), 1)}</span>
        </div>
      ))}
    </div>
  );
}

export function CompeticoesPainel() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<Competicao | null>(null);
  const [form, setForm] = useState<FormState>(FORM_INICIAL);
  const [excluir, setExcluir] = useState<Competicao | null>(null);

  const { data: competicoes = [], isLoading } = useQuery({
    queryKey: ["admin-competicoes", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competicoes")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("data_inicio", { ascending: false });
      if (error) throw error;
      return data as Competicao[];
    },
    enabled: !!organization?.id,
  });

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-competicoes-alunos", organization?.id],
    queryFn: async () => {
      const alunosData = await todasAsLinhas((de, ate) =>
        supabase.from("alunos").select("id, user_id").eq("organization_id", organization!.id).order("id").range(de, ate)
      );
      const perfis = await perfisDosUsuarios(alunosData.map((a) => a.user_id));
      return alunosData.map((a) => ({ id: a.id, nome: perfis.get(a.user_id)?.full_name ?? "—" })) as AlunoOpcao[];
    },
    enabled: !!organization?.id,
  });

  const { data: participantesPorCompeticao = {} } = useQuery({
    queryKey: ["admin-competicoes-participantes", competicoes.map((c) => c.id).join(",")],
    queryFn: async () => {
      if (competicoes.length === 0) return {};
      const data = await todasAsLinhas((de, ate) =>
        supabase
          .from("competicao_participantes")
          .select("competicao_id, aluno_id")
          .in("competicao_id", competicoes.map((c) => c.id))
          .order("id")
          .range(de, ate)
      );
      const map: Record<string, string[]> = {};
      data.forEach((p) => {
        map[p.competicao_id] = [...(map[p.competicao_id] ?? []), p.aluno_id];
      });
      return map;
    },
    enabled: competicoes.length > 0,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Organização inválida");
      const payload = {
        organization_id: organization.id,
        titulo: form.titulo.trim(),
        descricao: form.descricao.trim() || null,
        data_inicio: form.dataInicio,
        data_fim: form.dataFim,
        metrica: form.metrica,
        para_todos: form.paraTodos,
      };

      let competicaoId: string;
      if (editando) {
        const { error } = await supabase.from("competicoes").update(payload).eq("id", editando.id);
        if (error) throw error;
        competicaoId = editando.id;
      } else {
        const { data, error } = await supabase.from("competicoes").insert(payload).select("id").single();
        if (error) throw error;
        competicaoId = data.id;
      }

      if (!form.paraTodos) {
        await supabase.from("competicao_participantes").delete().eq("competicao_id", competicaoId);
        if (form.selecionados.length > 0) {
          const { error } = await supabase
            .from("competicao_participantes")
            .insert(form.selecionados.map((alunoId) => ({ organization_id: organization.id, competicao_id: competicaoId, aluno_id: alunoId })));
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast({ title: editando ? "Competição atualizada!" : "Competição criada!" });
      void queryClient.invalidateQueries({ queryKey: ["admin-competicoes", organization?.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-competicoes-participantes"] });
      fecharDialog();
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const excluirCompeticao = useMutation({
    mutationFn: async () => {
      if (!excluir) return;
      const { error } = await supabase.from("competicoes").delete().eq("id", excluir.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Competição excluída" });
      void queryClient.invalidateQueries({ queryKey: ["admin-competicoes", organization?.id] });
      setExcluir(null);
    },
    onError: (error: Error) => toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }),
  });

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setDialogAberto(true);
  };

  const abrirEdicao = (c: Competicao) => {
    setEditando(c);
    setForm({
      titulo: c.titulo,
      descricao: c.descricao ?? "",
      dataInicio: c.data_inicio,
      dataFim: c.data_fim,
      metrica: c.metrica,
      paraTodos: c.para_todos,
      selecionados: participantesPorCompeticao[c.id] ?? [],
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

  const hoje = hojeBrasilia();
  const statusDe = (c: Competicao) => (c.data_inicio > hoje ? "Pendente" : c.data_fim < hoje ? "Encerrada" : "Ativa");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={abrirNovo}>
          <Plus className="h-4 w-4 mr-1.5" /> Nova Competição
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!isLoading && competicoes.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhuma competição ainda.</CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {competicoes.map((c) => {
          const status = statusDe(c);
          const totalParticipantes = c.para_todos ? alunos.length : (participantesPorCompeticao[c.id] ?? []).length;
          return (
            <Card key={c.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.titulo}</p>
                    {c.descricao && <p className="text-xs text-muted-foreground">{c.descricao}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEdicao(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setExcluir(c)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={status === "Ativa" ? "default" : "secondary"}>{status}</Badge>
                  <Badge variant="outline">{METRICA_LABEL[c.metrica]}</Badge>
                  <Badge variant="outline">
                    <Users className="h-3 w-3 mr-1" /> {totalParticipantes} {c.para_todos && "(todos)"}
                  </Badge>
                  <Badge variant="outline">
                    {formatarDataBR(c.data_inicio)} - {formatarDataBR(c.data_fim)}
                  </Badge>
                </div>
                {status !== "Pendente" && <RankingCompeticao competicaoId={c.id} />}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={dialogAberto} onOpenChange={(open) => !open && fecharDialog()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Competição" : "Nova Competição"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Métrica</Label>
              <Select value={form.metrica} onValueChange={(v) => setForm((f) => ({ ...f, metrica: v as Metrica }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICAS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METRICA_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            <Button disabled={!form.titulo.trim() || !form.dataInicio || !form.dataFim || salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Salvando..." : editando ? "Salvar alterações" : "Criar competição"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!excluir} onOpenChange={(open) => !open && setExcluir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir competição?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Isso remove "{excluir?.titulo}" e a lista de participantes. Não pode ser desfeito.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={excluirCompeticao.isPending} onClick={() => excluirCompeticao.mutate()}>
              {excluirCompeticao.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
