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
import { UsersRound, UserPlus, Pencil, Power, UserX, Copy, Check, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Enums } from "@/integrations/supabase/types";

type PapelEquipe = Extract<Enums<"app_role">, "gestor" | "professor" | "nutricionista" | "recepcao">;

const PAPEL_LABEL: Record<string, string> = {
  gestor: "Gestor",
  professor: "Personal",
  nutricionista: "Nutricionista",
  recepcao: "Recepção",
};

const PAPEIS_EDITAVEIS: PapelEquipe[] = ["gestor", "recepcao", "professor", "nutricionista"];

interface MembroRow {
  user_id: string;
  role: string;
  status: string;
  full_name: string;
}

const EMPTY_EQUIPE: MembroRow[] = [];

export default function AdminEquipe() {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [convidarAberto, setConvidarAberto] = useState(false);
  const [editando, setEditando] = useState<MembroRow | null>(null);
  const [removendo, setRemovendo] = useState<MembroRow | null>(null);
  const [inativando, setInativando] = useState<MembroRow | null>(null);

  const { data: equipe = EMPTY_EQUIPE, isLoading } = useQuery({
    queryKey: ["admin-equipe", organization?.id],
    queryFn: async () => {
      const { data: membros, error } = await supabase
        .from("organization_members")
        .select("user_id, role, status")
        .eq("organization_id", organization!.id)
        .in("role", ["gestor", "professor", "nutricionista", "recepcao"])
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

  const invalidarEquipe = () => queryClient.invalidateQueries({ queryKey: ["admin-equipe", organization?.id] });

  const alternarStatus = useMutation({
    mutationFn: async (membro: MembroRow) => {
      const novoStatus = membro.status === "active" ? "inactive" : "active";
      const { error } = await supabase
        .from("organization_members")
        .update({ status: novoStatus })
        .eq("organization_id", organization!.id)
        .eq("user_id", membro.user_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Status atualizado." });
      invalidarEquipe();
      setInativando(null);
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao atualizar status", description: error.message, variant: "destructive" }),
  });

  const remover = useMutation({
    mutationFn: async (membro: MembroRow) => {
      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("organization_id", organization!.id)
        .eq("user_id", membro.user_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Acesso revogado." });
      invalidarEquipe();
      setRemovendo(null);
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao remover membro", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UsersRound className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Equipe</h1>
        </div>
        <Button size="sm" onClick={() => setConvidarAberto(true)} disabled={!organization}>
          <UserPlus className="h-4 w-4 mr-1.5" />
          Cadastrar Funcionário
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
                        {membro.status === "active" ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {(() => {
                        const ehVoceMesmo = membro.user_id === user?.id;
                        return (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Editar"
                              onClick={() => setEditando(membro)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={
                                ehVoceMesmo
                                  ? "Você não pode inativar seu próprio acesso"
                                  : membro.status === "active"
                                    ? "Inativar"
                                    : "Ativar"
                              }
                              disabled={
                                ehVoceMesmo ||
                                (alternarStatus.isPending && alternarStatus.variables?.user_id === membro.user_id)
                              }
                              onClick={() =>
                                membro.status === "active" ? setInativando(membro) : alternarStatus.mutate(membro)
                              }
                            >
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              title={ehVoceMesmo ? "Você não pode remover seu próprio acesso" : "Remover"}
                              disabled={ehVoceMesmo}
                              onClick={() => setRemovendo(membro)}
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CadastrarMembroDialog
        open={convidarAberto}
        onOpenChange={setConvidarAberto}
        onSuccess={invalidarEquipe}
      />

      <EditarMembroDialog membro={editando} onOpenChange={(open) => !open && setEditando(null)} onSuccess={invalidarEquipe} />

      <Dialog open={!!inativando} onOpenChange={(open) => !open && setInativando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inativar {inativando?.full_name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso bloqueia o login deste membro na organização até alguém reativá-lo. O acesso pode ser
            restaurado a qualquer momento clicando em "Ativar".
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInativando(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={alternarStatus.isPending}
              onClick={() => inativando && alternarStatus.mutate(inativando)}
            >
              {alternarStatus.isPending ? "Inativando..." : "Inativar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removendo} onOpenChange={(open) => !open && setRemovendo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover {removendo?.full_name} da equipe?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso revoga imediatamente o acesso deste membro a esta organização. O convite pode ser refeito depois,
            se necessário.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovendo(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={remover.isPending}
              onClick={() => removendo && remover.mutate(removendo)}
            >
              {remover.isPending ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CadastroForm {
  full_name: string;
  email: string;
  telefone: string;
  cpf: string;
  papel: PapelEquipe | "";
}

const CADASTRO_INICIAL: CadastroForm = { full_name: "", email: "", telefone: "", cpf: "", papel: "" };

interface CredenciaisGeradas {
  full_name: string;
  email: string;
  senha_temporaria: string;
}

function CadastrarMembroDialog({
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
  const [credenciais, setCredenciais] = useState<CredenciaisGeradas | null>(null);

  const cadastrar = useMutation({
    mutationFn: async () => {
      if (!form.papel) throw new Error("Selecione o papel do funcionário.");
      const { data, error } = await supabase.functions.invoke<{ user_id: string; senha_temporaria: string }>(
        "cadastrar-membro-equipe",
        {
          body: {
            email: form.email,
            full_name: form.full_name,
            telefone: form.telefone,
            cpf: form.cpf,
            papel: form.papel,
          },
        }
      );
      if (error) throw error;
      if (!data) throw new Error("Resposta inesperada do servidor.");
      return data;
    },
    onSuccess: (data) => {
      onOpenChange(false);
      onSuccess();
      setCredenciais({ full_name: form.full_name, email: form.email, senha_temporaria: data.senha_temporaria });
      setForm(CADASTRO_INICIAL);
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível cadastrar o funcionário", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar Funcionário</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Cadastro direto — a conta é criada e liberada na hora, sem envio de e-mail de convite. Ao final, você
            recebe a senha temporária para repassar ao funcionário.
          </p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              cadastrar.mutate();
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
              <Label htmlFor="membro-cpf">CPF</Label>
              <Input
                id="membro-cpf"
                value={form.cpf}
                onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))}
                placeholder="000.000.000-00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <Select value={form.papel} onValueChange={(v) => setForm((f) => ({ ...f, papel: v as PapelEquipe }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o papel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recepcao">Recepção</SelectItem>
                  <SelectItem value="professor">Personal (Professor)</SelectItem>
                  <SelectItem value="nutricionista">Nutricionista</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={cadastrar.isPending || !form.papel}>
                {cadastrar.isPending ? "Cadastrando..." : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CredenciaisGeradasDialog credenciais={credenciais} onOpenChange={(open) => !open && setCredenciais(null)} />
    </>
  );
}

function CredenciaisGeradasDialog({
  credenciais,
  onOpenChange,
}: {
  credenciais: CredenciaisGeradas | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    if (!credenciais) return;
    const texto = `E-mail: ${credenciais.email}\nSenha temporária: ${credenciais.senha_temporaria}`;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast({ title: "Não foi possível copiar", description: "Copie manualmente os dados abaixo.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!credenciais} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Funcionário cadastrado
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {credenciais?.full_name} já pode acessar o ArkeFit. Repasse os dados abaixo por WhatsApp ou verbalmente —
          nenhum e-mail foi enviado. Esta senha só é exibida agora; se for perdida, o funcionário pode redefini-la
          pelo "Esqueci minha senha" na tela de login.
        </p>
        <div className="rounded-md border bg-muted/40 p-3 space-y-1.5 font-mono text-sm">
          <div>
            <span className="text-muted-foreground">E-mail: </span>
            {credenciais?.email}
          </div>
          <div>
            <span className="text-muted-foreground">Senha: </span>
            {credenciais?.senha_temporaria}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copiar}>
            {copiado ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
            {copiado ? "Copiado!" : "Copiar dados"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditForm {
  full_name: string;
  email: string;
  papel: PapelEquipe;
}

function EditarMembroDialog({
  membro,
  onOpenChange,
  onSuccess,
}: {
  membro: MembroRow | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<EditForm | null>(null);

  // O e-mail atual não é buscado — trocá-lo exige a Admin API, então o
  // campo começa vazio e só é enviado se preenchido.
  const formAtual: EditForm = form ?? {
    full_name: membro?.full_name ?? "",
    email: "",
    papel: (membro?.role as PapelEquipe) ?? "professor",
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!membro) throw new Error("Nenhum membro selecionado.");
      if (!organization) throw new Error("Nenhuma organização vinculada.");
      const nomeMudou = formAtual.full_name.trim() && formAtual.full_name.trim() !== membro.full_name;
      const papelMudou = formAtual.papel !== membro.role;
      const { error } = await supabase.functions.invoke("editar-membro-equipe", {
        body: {
          user_id: membro.user_id,
          organization_id: organization.id,
          full_name: nomeMudou ? formAtual.full_name.trim() : undefined,
          email: formAtual.email.trim() || undefined,
          role: papelMudou ? formAtual.papel : undefined,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Membro atualizado!" });
      setForm(null);
      onOpenChange(false);
      onSuccess();
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao atualizar membro", description: error.message, variant: "destructive" }),
  });

  const fechar = (open: boolean) => {
    if (!open) setForm(null);
    onOpenChange(open);
  };

  return (
    <Dialog open={!!membro} onOpenChange={fechar}>
      <DialogContent key={membro?.user_id}>
        <DialogHeader>
          <DialogTitle>Editar {membro?.full_name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="editar-nome">Nome completo</Label>
            <Input
              id="editar-nome"
              value={formAtual.full_name}
              onChange={(e) => setForm({ ...formAtual, full_name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="editar-email">Novo e-mail (deixe em branco para manter o atual)</Label>
            <Input
              id="editar-email"
              type="email"
              value={formAtual.email}
              onChange={(e) => setForm({ ...formAtual, email: e.target.value })}
              placeholder="novo.email@exemplo.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Papel</Label>
            <Select value={formAtual.papel} onValueChange={(v) => setForm({ ...formAtual, papel: v as PapelEquipe })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAPEIS_EDITAVEIS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PAPEL_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => fechar(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
