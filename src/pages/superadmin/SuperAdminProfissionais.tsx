import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UserCog, UserPlus, Dumbbell, Apple } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Enums } from "@/integrations/supabase/types";

type Especialidade = Extract<Enums<"app_role">, "professor" | "nutricionista">;

type ProfissionalRow = {
  organization_id: string;
  nome: string;
  especialidade: Especialidade;
  status: Enums<"org_status">;
  email: string | null;
  status_convite: string | null;
  alunos_total: number;
  created_at: string;
  sem_gestor: boolean;
};

const ESPECIALIDADE_LABEL: Record<Especialidade, string> = {
  professor: "Personal Trainer",
  nutricionista: "Nutricionista",
};

const STATUS_CONVITE_LABEL: Record<string, string> = {
  active: "Ativou a conta",
  pending: "Convite pendente",
  inactive: "Inativo",
};

const CADASTRO_INICIAL = { full_name: "", email: "", telefone: "" };

export default function SuperAdminProfissionais() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [novoAberto, setNovoAberto] = useState(false);
  const [especialidade, setEspecialidade] = useState<Especialidade | null>(null);
  const [form, setForm] = useState(CADASTRO_INICIAL);

  const {
    data: profissionais = [],
    isLoading,
    error: erroProfissionais,
  } = useQuery({
    queryKey: ["superadmin-profissionais-autonomos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_profissionais_autonomos");
      if (error) throw error;
      return (data ?? []) as ProfissionalRow[];
    },
  });

  const fecharModal = () => {
    setNovoAberto(false);
    setEspecialidade(null);
    setForm(CADASTRO_INICIAL);
  };

  const convidar = useMutation({
    mutationFn: async () => {
      if (!especialidade) throw new Error("Selecione a especialidade.");
      const { error } = await supabase.functions.invoke("convidar-profissional-autonomo", {
        body: {
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          telefone: form.telefone.trim() || undefined,
          especialidade,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Profissional convidado!", description: "O link de ativação foi enviado por e-mail." });
      void queryClient.invalidateQueries({ queryKey: ["superadmin-profissionais-autonomos"] });
      fecharModal();
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao convidar", description: error.message, variant: "destructive" }),
  });

  const formValido = !!especialidade && form.full_name.trim() && form.email.trim();

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserCog className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Gestão de Profissionais Autônomos</h1>
        </div>
        <Button size="sm" onClick={() => setNovoAberto(true)}>
          <UserPlus className="h-4 w-4 mr-1" /> Novo Profissional
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Personal Trainers e Nutricionistas que compram a plataforma direto da ARKE para montar a própria
        carteira de alunos, fora do modelo de academia/studio.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Profissionais cadastrados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {erroProfissionais && (
            <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Não foi possível carregar a lista: {(erroProfissionais as Error).message}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-3">Profissional</th>
                  <th className="p-3">Especialidade</th>
                  <th className="p-3">E-mail</th>
                  <th className="p-3">Alunos</th>
                  <th className="p-3">Convite</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {!isLoading && !erroProfissionais && profissionais.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-muted-foreground">
                      Nenhum profissional autônomo cadastrado ainda.
                    </td>
                  </tr>
                )}
                {profissionais.map((p) => (
                  <tr key={p.organization_id} className="border-b border-border last:border-0">
                    <td className="p-3 font-medium">{p.nome}</td>
                    <td className="p-3">
                      <Badge variant="secondary">{ESPECIALIDADE_LABEL[p.especialidade] ?? p.especialidade}</Badge>
                    </td>
                    <td className="p-3 text-xs">
                      {p.sem_gestor ? (
                        <Badge variant="destructive">Sem gestor vinculado</Badge>
                      ) : (
                        p.email
                      )}
                    </td>
                    <td className="p-3">{p.alunos_total}</td>
                    <td className="p-3">
                      <Badge variant={p.status_convite === "active" ? "default" : "outline"}>
                        {p.sem_gestor ? "—" : STATUS_CONVITE_LABEL[p.status_convite ?? ""] ?? "—"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Badge variant={p.status === "ativo" || p.status === "trial" ? "default" : "secondary"}>
                        {p.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={novoAberto} onOpenChange={(open) => !open && fecharModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Profissional Autônomo</DialogTitle>
          </DialogHeader>

          {!especialidade ? (
            <div className="grid grid-cols-2 gap-3 py-2">
              <button
                type="button"
                onClick={() => setEspecialidade("professor")}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 border-border p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
                )}
              >
                <Dumbbell className="h-8 w-8 text-primary" />
                <span className="font-semibold">Personal Trainer</span>
              </button>
              <button
                type="button"
                onClick={() => setEspecialidade("nutricionista")}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 border-border p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
                )}
              >
                <Apple className="h-8 w-8 text-primary" />
                <span className="font-semibold">Nutricionista</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <Badge variant="secondary" className="w-fit">
                {ESPECIALIDADE_LABEL[especialidade]}
              </Badge>
              <div className="space-y-1.5">
                <Label htmlFor="prof-nome">Nome completo</Label>
                <Input
                  id="prof-nome"
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prof-email">E-mail</Label>
                <Input
                  id="prof-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prof-telefone">Telefone (opcional)</Label>
                <Input
                  id="prof-telefone"
                  value={form.telefone}
                  onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {especialidade && (
              <Button variant="outline" onClick={() => setEspecialidade(null)}>
                Voltar
              </Button>
            )}
            <Button variant="ghost" onClick={fecharModal}>
              Cancelar
            </Button>
            {especialidade && (
              <Button disabled={!formValido || convidar.isPending} onClick={() => convidar.mutate()}>
                {convidar.isPending ? "Enviando..." : "Enviar convite de ativação"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
