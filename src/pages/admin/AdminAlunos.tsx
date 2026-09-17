import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, CalendarOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NIVEL_LABEL: Record<string, string> = {
  essencial: "Essencial",
  integrado: "Integrado",
  integral: "Integral",
};

const FASE_LABEL: Record<string, string> = {
  mapa: "M.A.P.A.®",
  base: "B.A.S.E.®",
  rota: "R.O.T.A.®",
  apex: "A.P.E.X.®",
  legado: "L.E.G.A.D.O.®",
};

const DIAS_SEMANA = [
  { valor: 1, label: "Seg" },
  { valor: 2, label: "Ter" },
  { valor: 3, label: "Qua" },
  { valor: 4, label: "Qui" },
  { valor: 5, label: "Sex" },
  { valor: 6, label: "Sáb" },
  { valor: 7, label: "Dom" },
];

interface AlunoRow {
  id: string;
  nivel_atacado: string;
  fase_jornada: string;
  objetivo: string | null;
  data_inicio: string | null;
  dias_descanso: number[];
  full_name: string;
}

export default function AdminAlunos() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alunoEditando, setAlunoEditando] = useState<AlunoRow | null>(null);
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);

  const { data: alunos = [], isLoading } = useQuery({
    queryKey: ["admin-alunos", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select("id, user_id, nivel_atacado, objetivo, data_inicio, fase_jornada, dias_descanso")
        .eq("organization_id", organization!.id)
        .order("data_inicio", { ascending: false });
      if (error) throw error;

      const userIds = alunosData.map((a) => a.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };

      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return alunosData.map((a) => ({ ...a, full_name: nomeByUserId.get(a.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  const salvarDiasDescanso = useMutation({
    mutationFn: async () => {
      if (!alunoEditando) return;
      const { error } = await supabase
        .from("alunos")
        .update({ dias_descanso: diasSelecionados })
        .eq("id", alunoEditando.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Dias de descanso atualizados" });
      setAlunoEditando(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const abrirEdicao = (aluno: AlunoRow) => {
    setAlunoEditando(aluno);
    setDiasSelecionados(aluno.dias_descanso ?? []);
  };

  const toggleDia = (dia: number) => {
    setDiasSelecionados((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]));
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Alunos</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
          {!isLoading && alunos.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhum aluno cadastrado ainda.</p>
          )}
          {alunos.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Fase</TableHead>
                  <TableHead>Objetivo</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead>Descanso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alunos.map((aluno) => (
                  <TableRow key={aluno.id}>
                    <TableCell className="font-medium">{aluno.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{NIVEL_LABEL[aluno.nivel_atacado] ?? aluno.nivel_atacado}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{FASE_LABEL[aluno.fase_jornada] ?? aluno.fase_jornada}</Badge>
                    </TableCell>
                    <TableCell>{aluno.objetivo ?? "—"}</TableCell>
                    <TableCell>
                      {aluno.data_inicio ? new Date(aluno.data_inicio).toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => abrirEdicao(aluno)}>
                        <CalendarOff className="h-3.5 w-3.5 mr-1" />
                        {aluno.dias_descanso?.length ?? 0} dia(s)
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!alunoEditando} onOpenChange={(open) => !open && setAlunoEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dias de descanso — {alunoEditando?.full_name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Nesses dias, a automação de "treinos previstos sem registro" não considera falta.
          </p>
          <div className="grid grid-cols-4 gap-3 py-2">
            {DIAS_SEMANA.map((d) => (
              <label key={d.valor} className="flex items-center gap-2 text-sm">
                <Checkbox checked={diasSelecionados.includes(d.valor)} onCheckedChange={() => toggleDia(d.valor)} />
                {d.label}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button disabled={salvarDiasDescanso.isPending} onClick={() => salvarDiasDescanso.mutate()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
