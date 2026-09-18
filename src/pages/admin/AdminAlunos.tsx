import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, CalendarOff, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Enums } from "@/integrations/supabase/types";

type Nivel = Enums<"nivel_atacado">;

const NIVEL_LABEL: Record<string, string> = {
  essencial: "Essencial",
  integrado: "Integrado",
  elite: "Elite",
};

const FASE_LABEL: Record<string, string> = {
  mapa: "M.A.P.A.®",
  base: "B.A.S.E.®",
  rota: "R.O.T.A.®",
  apex: "A.P.E.X.®",
  legado: "L.E.G.A.D.O.®",
};

const ASSINATURA_LABEL: Record<string, string> = {
  ativa: "Ativa",
  atrasada: "Atrasada",
  cancelada: "Cancelada",
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
  user_id: string;
  nivel_atacado: string;
  fase_jornada: string;
  objetivo: string | null;
  data_inicio: string | null;
  dias_descanso: number[];
  full_name: string;
  assinatura_status: string | null;
}

const EMPTY_ALUNOS: AlunoRow[] = [];

export default function AdminAlunos() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alunoEditando, setAlunoEditando] = useState<AlunoRow | null>(null);
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);
  const [cadastroAberto, setCadastroAberto] = useState(false);

  const { data: alunos = EMPTY_ALUNOS, isLoading } = useQuery({
    queryKey: ["admin-alunos", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select("id, user_id, nivel_atacado, objetivo, data_inicio, fase_jornada, dias_descanso")
        .eq("organization_id", organization!.id)
        .order("data_inicio", { ascending: false });
      if (error) throw error;

      const userIds = alunosData.map((a) => a.user_id);
      const alunoIds = alunosData.map((a) => a.id);

      const [{ data: profiles }, { data: assinaturas }] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
          : Promise.resolve({ data: [] as { user_id: string; full_name: string }[] }),
        alunoIds.length
          ? supabase.from("aluno_assinaturas").select("aluno_id, status").in("aluno_id", alunoIds)
          : Promise.resolve({ data: [] as { aluno_id: string; status: string }[] }),
      ]);

      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      const statusByAlunoId = new Map((assinaturas ?? []).map((a) => [a.aluno_id, a.status]));
      return alunosData.map((a) => ({
        ...a,
        full_name: nomeByUserId.get(a.user_id) ?? "—",
        assinatura_status: statusByAlunoId.get(a.id) ?? null,
      }));
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Alunos</h1>
        </div>
        <Button size="sm" onClick={() => setCadastroAberto(true)} disabled={!organization}>
          <UserPlus className="h-4 w-4 mr-1.5" />
          Cadastrar Aluno
        </Button>
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
                  <TableHead>Plano</TableHead>
                  <TableHead>Assinatura</TableHead>
                  <TableHead>Fase</TableHead>
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
                      {aluno.assinatura_status ? (
                        <Badge variant={aluno.assinatura_status === "ativa" ? "default" : "outline"}>
                          {ASSINATURA_LABEL[aluno.assinatura_status] ?? aluno.assinatura_status}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem assinatura</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{FASE_LABEL[aluno.fase_jornada] ?? aluno.fase_jornada}</Badge>
                    </TableCell>
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

      <CadastrarAlunoDialog
        open={cadastroAberto}
        onOpenChange={setCadastroAberto}
        onSuccess={() => void queryClient.invalidateQueries({ queryKey: ["admin-alunos", organization?.id] })}
      />
    </div>
  );
}

interface CadastroForm {
  full_name: string;
  email: string;
  telefone: string;
  cpf: string;
  nivel_atacado: Nivel | "";
}

const CADASTRO_INICIAL: CadastroForm = { full_name: "", email: "", telefone: "", cpf: "", nivel_atacado: "" };

function CadastrarAlunoDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<CadastroForm>(CADASTRO_INICIAL);

  const cadastrar = useMutation({
    mutationFn: async () => {
      if (!form.nivel_atacado) throw new Error("Selecione o plano do aluno.");
      const { error } = await supabase.functions.invoke<{ user_id: string }>("convidar-membro", {
        body: {
          email: form.email,
          full_name: form.full_name,
          telefone: form.telefone,
          cpf: form.cpf,
          papel: "aluno",
          nivel_atacado: form.nivel_atacado,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Aluno cadastrado", description: "Um e-mail de convite foi enviado para definir a senha." });
      setForm(CADASTRO_INICIAL);
      onOpenChange(false);
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível cadastrar o aluno", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar aluno</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            cadastrar.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="aluno-nome">Nome completo</Label>
            <Input
              id="aluno-nome"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aluno-email">E-mail</Label>
            <Input
              id="aluno-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="aluno-telefone">Telefone</Label>
              <Input
                id="aluno-telefone"
                value={form.telefone}
                onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                placeholder="(11) 91234-5678"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aluno-cpf">CPF</Label>
              <Input
                id="aluno-cpf"
                value={form.cpf}
                onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))}
                placeholder="000.000.000-00"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Plano</Label>
            <Select
              value={form.nivel_atacado}
              onValueChange={(v) => setForm((f) => ({ ...f, nivel_atacado: v as Nivel }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o plano" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="essencial">Essencial</SelectItem>
                <SelectItem value="integrado">Integrado</SelectItem>
                <SelectItem value="elite">Elite</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={cadastrar.isPending}>
              {cadastrar.isPending ? "Cadastrando..." : "Cadastrar e convidar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
