import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UsersRound, UserPlus, UserCog } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { startImpersonation } from "@/lib/impersonation";
import type { Enums } from "@/integrations/supabase/types";

type PapelEquipe = Extract<Enums<"app_role">, "gestor" | "professor" | "nutricionista">;

const PAPEL_LABEL: Record<string, string> = {
  gestor: "Gestor",
  professor: "Personal",
  nutricionista: "Nutricionista",
};

interface MembroRow {
  user_id: string;
  role: string;
  status: string;
  full_name: string;
}

const EMPTY_EQUIPE: MembroRow[] = [];

export default function AdminEquipe() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [convidarAberto, setConvidarAberto] = useState(false);
  const [simulandoUserId, setSimulandoUserId] = useState<string | null>(null);

  const { data: equipe = EMPTY_EQUIPE, isLoading } = useQuery({
    queryKey: ["admin-equipe", organization?.id],
    queryFn: async () => {
      const { data: membros, error } = await supabase
        .from("organization_members")
        .select("user_id, role, status")
        .eq("organization_id", organization!.id)
        .in("role", ["gestor", "professor", "nutricionista"])
        .order("role");
      if (error) throw error;

      const userIds = membros.map((m) => m.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };

      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return membros.map((m) => ({ ...m, full_name: nomeByUserId.get(m.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  const simular = async (userId: string) => {
    setSimulandoUserId(userId);
    const { error } = await startImpersonation(userId);
    setSimulandoUserId(null);
    if (error) {
      toast({ title: "Não foi possível simular este perfil", description: error.message, variant: "destructive" });
      return;
    }
    window.location.assign("/#/admin");
    window.location.reload();
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UsersRound className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Equipe</h1>
        </div>
        <Button size="sm" onClick={() => setConvidarAberto(true)} disabled={!organization}>
          <UserPlus className="h-4 w-4 mr-1.5" />
          Convidar
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
          {!isLoading && equipe.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhum membro de equipe cadastrado ainda.</p>
          )}
          {equipe.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipe.map((membro) => (
                  <TableRow key={membro.user_id}>
                    <TableCell className="font-medium">{membro.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{PAPEL_LABEL[membro.role] ?? membro.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={membro.status === "active" ? "default" : "outline"}>
                        {membro.status === "active" ? "Ativo" : membro.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={simulandoUserId === membro.user_id}
                        onClick={() => void simular(membro.user_id)}
                        title="Simular este perfil"
                      >
                        <UserCog className="h-3.5 w-3.5 mr-1" />
                        Simular
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConvidarMembroDialog
        open={convidarAberto}
        onOpenChange={setConvidarAberto}
        onSuccess={() => void queryClient.invalidateQueries({ queryKey: ["admin-equipe", organization?.id] })}
      />
    </div>
  );
}

interface ConviteForm {
  full_name: string;
  email: string;
  telefone: string;
  papel: PapelEquipe | "";
}

const CONVITE_INICIAL: ConviteForm = { full_name: "", email: "", telefone: "", papel: "" };

function ConvidarMembroDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<ConviteForm>(CONVITE_INICIAL);

  const convidar = useMutation({
    mutationFn: async () => {
      if (!form.papel) throw new Error("Selecione o papel do convidado.");
      const { error } = await supabase.functions.invoke("convidar-membro", {
        body: {
          email: form.email,
          full_name: form.full_name,
          telefone: form.telefone,
          papel: form.papel,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Convite enviado", description: "Um e-mail foi enviado para definir a senha de acesso." });
      setForm(CONVITE_INICIAL);
      onOpenChange(false);
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível enviar o convite", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar para a equipe</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            convidar.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="membro-nome">Nome completo</Label>
            <Input
              id="membro-nome"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="membro-email">E-mail</Label>
            <Input
              id="membro-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="membro-telefone">Telefone</Label>
            <Input
              id="membro-telefone"
              value={form.telefone}
              onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
              placeholder="(11) 91234-5678"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Papel</Label>
            <Select value={form.papel} onValueChange={(v) => setForm((f) => ({ ...f, papel: v as PapelEquipe }))}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o papel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professor">Personal (Professor)</SelectItem>
                <SelectItem value="nutricionista">Nutricionista</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={convidar.isPending}>
              {convidar.isPending ? "Enviando..." : "Convidar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
