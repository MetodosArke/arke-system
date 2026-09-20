import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil } from "lucide-react";
import type { Enums, Tables } from "@/integrations/supabase/types";

type Periodicidade = Enums<"periodicidade_plano_academia">;
type PlanoAcademia = Tables<"planos_academia">;

const PERIODICIDADE_LABEL: Record<Periodicidade, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

function parseMoeda(valor: string): number {
  const normalizado = Number(valor.trim().replace(",", "."));
  return Number.isFinite(normalizado) ? normalizado : 0;
}

const FORM_VAZIO = { id: "", nome: "", periodicidade: "mensal" as Periodicidade, valor: "", descricao: "", ativo: true };

export function PlanosAcademiaPainel() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogAberto, setDialogAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);

  const { data: planos = [], isLoading } = useQuery({
    queryKey: ["planos-academia", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos_academia")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as PlanoAcademia[];
    },
    enabled: !!organization?.id,
  });

  const salvarPlano = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Organização não encontrada");
      if (!form.nome.trim()) throw new Error("Informe o nome do plano.");
      const valor = parseMoeda(form.valor);
      if (valor <= 0) throw new Error("O valor precisa ser maior que zero.");

      if (form.id) {
        const { error } = await supabase
          .from("planos_academia")
          .update({ nome: form.nome.trim(), periodicidade: form.periodicidade, valor, descricao: form.descricao.trim() || null, ativo: form.ativo })
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("planos_academia").insert({
          organization_id: organization.id,
          nome: form.nome.trim(),
          periodicidade: form.periodicidade,
          valor,
          descricao: form.descricao.trim() || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: form.id ? "Plano atualizado" : "Plano criado" });
      void queryClient.invalidateQueries({ queryKey: ["planos-academia", organization?.id] });
      setDialogAberto(false);
      setForm(FORM_VAZIO);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar plano", description: error.message, variant: "destructive" }),
  });

  const alternarAtivo = useMutation({
    mutationFn: async (plano: PlanoAcademia) => {
      const { error } = await supabase.from("planos_academia").update({ ativo: !plano.ativo }).eq("id", plano.id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["planos-academia", organization?.id] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar plano", description: error.message, variant: "destructive" }),
  });

  const abrirEdicao = (plano: PlanoAcademia) => {
    setForm({
      id: plano.id,
      nome: plano.nome,
      periodicidade: plano.periodicidade,
      valor: String(plano.valor),
      descricao: plano.descricao ?? "",
      ativo: plano.ativo,
    });
    setDialogAberto(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          onClick={() => {
            setForm(FORM_VAZIO);
            setDialogAberto(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> Novo plano
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Planos próprios da academia (mensalidade), independentes do Método ARKE. A matrícula do aluno num desses
        planos é feita na tela de Alunos, e a cobrança recorrente roda automaticamente pelo Asaas.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Catálogo de planos</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!isLoading && planos.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhum plano cadastrado ainda.</p>
          )}
          {planos.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Periodicidade</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planos.map((plano) => (
                  <TableRow key={plano.id}>
                    <TableCell className="font-medium">
                      {plano.nome}
                      {plano.descricao && <p className="text-xs text-muted-foreground">{plano.descricao}</p>}
                    </TableCell>
                    <TableCell>{PERIODICIDADE_LABEL[plano.periodicidade]}</TableCell>
                    <TableCell>R$ {Number(plano.valor).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={plano.ativo ? "default" : "secondary"}>{plano.ativo ? "Ativo" : "Inativo"}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEdicao(plano)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Switch checked={plano.ativo} onCheckedChange={() => alternarAtivo.mutate(plano)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar plano" : "Novo plano"}</DialogTitle>
            <DialogDescription>Plano de mensalidade da própria academia.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex.: Plano Mensal" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Periodicidade</Label>
                <Select value={form.periodicidade} onValueChange={(v) => setForm((f) => ({ ...f, periodicidade: v as Periodicidade }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PERIODICIDADE_LABEL) as Periodicidade[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PERIODICIDADE_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} placeholder="0,00" inputMode="decimal" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvarPlano.mutate()} disabled={salvarPlano.isPending}>
              {salvarPlano.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
