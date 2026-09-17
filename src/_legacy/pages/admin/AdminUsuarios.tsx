import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, Search, MoreHorizontal, Check, X, UserPlus, MessageCircle, Send, Dumbbell, Video, Loader2, Filter, Pencil, Trash2, Mail, KeyRound } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { sendChatPush } from "@/lib/sendChatPush";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ControleAlunos from "@/components/admin/ControleAlunos";
import { CreditCard } from "lucide-react";
import { useAcademias } from "@/hooks/useAcademias";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface UsuarioRow {
  user_id: string;
  full_name: string;
  status: string;
  avatar_url: string | null;
  role?: string;
  academia_id?: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  aluno: "Aluno",
  professor: "Professor",
  admin: "Admin",
  super_admin: "Super Admin",
};

export default function AdminUsuarios() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("todos");
  const [academiaFilter, setAcademiaFilter] = useState<string>("todas");
  const [novoDialogOpen, setNovoDialogOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [novoRole, setNovoRole] = useState<string>("aluno");
  const [novoAcademiaNome, setNovoAcademiaNome] = useState("");
  const [creating, setCreating] = useState(false);
  const [msgDialogOpen, setMsgDialogOpen] = useState(false);
  const [msgAluno, setMsgAluno] = useState<UsuarioRow | null>(null);
  const [mensagemTexto, setMensagemTexto] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<UsuarioRow | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<string>("aluno");
  const [editAcademiaNome, setEditAcademiaNome] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<UsuarioRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const { academias, addAcademia } = useAcademias();
  const academiaOptions = academias.map((a) => a.nome);
  const academiaMap = new Map(academias.map((a) => [a.id, a.nome]));

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ["admin-usuarios"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url, status, academia_id")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rolesError) throw rolesError;

      const roleMap: Record<string, string> = {};
      (roles || []).forEach((r: any) => {
        roleMap[r.user_id] = r.role;
      });

      return (profiles || []).map((p: any) => ({
        ...p,
        role: roleMap[p.user_id] || "aluno",
      })) as UsuarioRow[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ status })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });
      toast({ title: "Status atualizado!" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const handleCreateUser = async () => {
    if (!novoNome.trim() || !novoEmail.trim()) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      const supabaseUrl = (supabase as any).supabaseUrl || import.meta.env.VITE_SUPABASE_URL;

      const response = await fetch(`${supabaseUrl}/functions/v1/create-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          email: novoEmail.trim(),
          full_name: novoNome.trim(),
          role: novoRole,
        }),
      });

      const rawBody = await response.text();
      let result: Record<string, unknown> = {};
      try {
        result = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        result = rawBody ? { error: rawBody } : {};
      }

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : typeof result.message === "string"
              ? (result.message as string)
              : `Erro ${response.status} ao criar usuário`,
        );
      }

      // Save academia if provided
      const newUserId = (result as any)?.user_id;
      if (newUserId && novoAcademiaNome.trim()) {
        const found = academias.find(
          (a) => a.nome.toLowerCase() === novoAcademiaNome.trim().toLowerCase()
        );
        const academiaId = found?.id || null;
        if (academiaId) {
          await supabase.from("profiles").update({ academia_id: academiaId } as any).eq("user_id", newUserId);
        }
      }

      toast({
        title: "Usuário criado!",
        description:
          result.email_sent === false
            ? "Usuário criado, mas o email de redefinição não foi enviado."
            : "Um email de redefinição de senha foi enviado.",
      });
      setNovoDialogOpen(false);
      setNovoNome("");
      setNovoEmail("");
      setNovoRole("aluno");
      setNovoAcademiaNome("");
      queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });
    } catch (err: any) {
      console.error("Create user error:", err);
      toast({ title: "Erro ao criar usuário", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const callUpdateUser = async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const response = await fetch(`${supabaseUrl}/functions/v1/update-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || `Erro ${response.status}`);
    return result;
  };

  const handleEditUser = async () => {
    if (!editUser || !editNome.trim()) return;
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = {
        user_id: editUser.user_id,
        full_name: editNome.trim(),
      };
      if (editEmail.trim() && editEmail.trim().toLowerCase() !== (editUser as any).email?.toLowerCase()) {
        body.email = editEmail.trim();
      }
      if (editRole !== editUser.role) {
        body.role = editRole;
      }
      await callUpdateUser(body);

      // Update academia_id directly via profiles (admin RLS)
      const found = academias.find(
        (a) => a.nome.toLowerCase() === editAcademiaNome.trim().toLowerCase()
      );
      const newAcademiaId = found?.id || null;
      if (newAcademiaId !== (editUser.academia_id || null)) {
        await supabase
          .from("profiles")
          .update({ academia_id: newAcademiaId } as any)
          .eq("user_id", editUser.user_id);
      }

      toast({ title: "Usuário atualizado!" });
      setEditDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!editUser) return;
    setSendingReset(true);
    try {
      const result = await callUpdateUser({
        user_id: editUser.user_id,
        send_password_reset: true,
      });
      if (result.reset_sent) {
        toast({ title: "Email enviado!", description: "Um link de redefinição de senha foi enviado." });
      } else {
        toast({ title: "Atenção", description: "Não foi possível enviar o email.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSendingReset(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({ user_id: deleteUser.user_id }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Erro ao excluir usuário");

      toast({ title: "Usuário excluído com sucesso!" });
      setDeleteDialogOpen(false);
      setDeleteUser(null);
      queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });
    } catch (err: any) {
      console.error("Delete user error:", err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const { data: mensagensTreino = [] } = useQuery({
    queryKey: ["admin-mensagens-treino", msgAluno?.user_id],
    queryFn: async () => {
      if (!msgAluno?.user_id) return [];
      const { data, error } = await supabase
        .from("mensagens_treino" as any)
        .select("*")
        .eq("aluno_id", msgAluno.user_id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!msgAluno?.user_id,
  });

  const sendMensagemAdmin = useMutation({
    mutationFn: async () => {
      if (!user?.id || !msgAluno?.user_id || !mensagemTexto.trim()) return;
      const { error } = await supabase
        .from("mensagens_treino" as any)
        .insert({
          aluno_id: msgAluno.user_id,
          remetente_id: user.id,
          remetente_tipo: "treinador",
          mensagem: mensagemTexto.trim(),
        } as any);
      if (error) throw error;
      void sendChatPush({
        recipientUserId: msgAluno.user_id,
        title: "Nova mensagem do seu treinador",
        body: mensagemTexto.trim().slice(0, 140),
        url: "/#/app/treinos",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-mensagens-treino"] });
      setMensagemTexto("");
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  const handleVideoUploadAdmin = async (file: File) => {
    if (!user?.id || !msgAluno?.user_id) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Vídeo muito grande", description: "O tamanho máximo é 10MB.", variant: "destructive" });
      return;
    }
    setUploadingVideo(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("chat-videos").upload(path, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("chat-videos").getPublicUrl(path);
      const { error } = await supabase.from("mensagens_treino" as any).insert({
        aluno_id: msgAluno.user_id,
        remetente_id: user.id,
        remetente_tipo: "treinador",
        mensagem: "📹 Vídeo",
        video_url: urlData.publicUrl,
      } as any);
      if (error) throw error;
      void sendChatPush({
        recipientUserId: msgAluno.user_id,
        title: "Nova mensagem do seu treinador",
        body: "📹 Vídeo enviado",
        url: "/#/app/treinos",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-mensagens-treino"] });
    } catch (err: any) {
      toast({ title: "Erro ao enviar vídeo", description: err.message, variant: "destructive" });
    } finally {
      setUploadingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagensTreino]);

  const filtered = usuarios.filter((u) => {
    if (!isSuperAdmin && u.role === "super_admin") return false;
    const matchSearch = u.full_name.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "todos" || u.role === roleFilter;
    const matchAcademia = academiaFilter === "todas" || u.academia_id === academiaFilter;
    return matchSearch && matchRole && matchAcademia;
  });

  const pendingCount = usuarios.filter((u) => u.status === "pending").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Usuários</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Gerencie todos os usuários do sistema</p>
        </div>
        <Button onClick={() => setNovoDialogOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-orange-500/10 px-4 py-3 text-sm text-orange-600 dark:text-orange-400">
          <UserPlus className="h-5 w-5 shrink-0" />
          <span className="font-medium">{pendingCount} usuário(s) aguardando aprovação</span>
        </div>
      )}

      <Tabs defaultValue="usuarios" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-flex">
          <TabsTrigger value="usuarios" className="gap-2">
            <Users className="h-4 w-4" />
            Usuários
          </TabsTrigger>
          <TabsTrigger value="controle" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Controle de Alunos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="controle">
          <ControleAlunos />
        </TabsContent>

        <TabsContent value="usuarios" className="space-y-4">

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar usuário..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filtrar por tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="aluno">Alunos</SelectItem>
            <SelectItem value="professor">Professores</SelectItem>
            <SelectItem value="admin">Admins</SelectItem>
            {isSuperAdmin && <SelectItem value="super_admin">Super Admins</SelectItem>}
          </SelectContent>
        </Select>
        <Select value={academiaFilter} onValueChange={setAcademiaFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Academia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as academias</SelectItem>
            {academias.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Users list */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-primary" />
            Lista de Usuários ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Users className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum usuário encontrado</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((usuario) => (
                <div
                  key={usuario.user_id}
                  className="flex items-center justify-between rounded-lg bg-muted/30 px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-muted/50 transition-colors gap-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {usuario.full_name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{usuario.full_name}</p>
                      <p className="text-xs text-muted-foreground">{ROLE_LABELS[usuario.role || "aluno"]}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2">
                    <Badge
                      variant={
                        usuario.role === "admin" || usuario.role === "super_admin"
                          ? "destructive"
                          : usuario.role === "professor"
                          ? "secondary"
                          : "default"
                      }
                      className="text-xs hidden sm:inline-flex"
                    >
                      {ROLE_LABELS[usuario.role || "aluno"]}
                    </Badge>
                    <Badge
                      variant={
                        usuario.status === "active"
                          ? "default"
                          : usuario.status === "pending"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-xs"
                    >
                      {usuario.status === "active" ? "Ativo" : usuario.status === "pending" ? "Pendente" : "Inativo"}
                    </Badge>

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setMsgAluno(usuario);
                        setMensagemTexto("");
                        setMsgDialogOpen(true);
                      }}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </Button>

                    {usuario.status === "pending" ? (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-emerald-600 hover:bg-emerald-500/10"
                          onClick={() => updateStatus.mutate({ userId: usuario.user_id, status: "active" })}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => updateStatus.mutate({ userId: usuario.user_id, status: "inactive" })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={async () => {
                              setEditUser(usuario);
                              setEditNome(usuario.full_name);
                              setEditEmail("");
                              setEditRole(usuario.role || "aluno");
                              setEditAcademiaNome(
                                usuario.academia_id ? academiaMap.get(usuario.academia_id) || "" : ""
                              );
                              setEditDialogOpen(true);
                              // Fetch current email from auth.users via edge function
                              try {
                                const { data: sessionData } = await supabase.auth.getSession();
                                const token = sessionData.session?.access_token;
                                if (!token) return;
                                const res = await fetch(
                                  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user`,
                                  {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                      Authorization: `Bearer ${token}`,
                                    },
                                    body: JSON.stringify({
                                      user_id: usuario.user_id,
                                      fetch_only: true,
                                    }),
                                  }
                                );
                                const data = await res.json();
                                if (res.ok && data?.email) setEditEmail(data.email);
                              } catch (err) {
                                console.error("Falha ao carregar email atual", err);
                              }
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              updateStatus.mutate({
                                userId: usuario.user_id,
                                status: usuario.status === "active" ? "inactive" : "active",
                              })
                            }
                          >
                            {usuario.status === "active" ? "Desativar" : "Ativar"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              setDeleteUser(usuario);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {/* New User Dialog */}
      <Dialog open={novoDialogOpen} onOpenChange={setNovoDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Novo Usuário
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input
                placeholder="Nome do usuário"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="email@exemplo.com"
                value={novoEmail}
                onChange={(e) => setNovoEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de usuário</Label>
              <Select value={novoRole} onValueChange={setNovoRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aluno">Aluno</SelectItem>
                  <SelectItem value="professor">Professor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Academia</Label>
              <SearchableSelect
                value={novoAcademiaNome}
                onValueChange={setNovoAcademiaNome}
                options={academiaOptions}
                placeholder="Selecione a academia"
                onAddNew={async (nome) => {
                  await addAcademia(nome);
                }}
                addNewLabel="Adicionar academia"
              />
            </div>
            <Button
              className="w-full"
              onClick={handleCreateUser}
              disabled={creating}
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar Usuário"
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              O usuário receberá um email para definir sua senha.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Treino Messages Dialog */}
      <Dialog open={msgDialogOpen} onOpenChange={setMsgDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Dumbbell className="h-5 w-5 text-primary" />
              Chat Treino - {msgAluno?.full_name}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 rounded-lg bg-muted/20 p-3 min-h-[200px] max-h-[400px]">
            {mensagensTreino.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma mensagem ainda.
              </p>
            ) : (
              mensagensTreino.map((msg: any) => {
                const isMine = msg.remetente_tipo === "treinador";
                return (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex flex-col max-w-[80%]",
                      isMine ? "ml-auto items-end" : "mr-auto items-start"
                    )}
                  >
                    <span
                      className={cn(
                        "text-[10px] font-semibold mb-0.5 px-1",
                        isMine ? "text-primary" : "text-emerald-600"
                      )}
                    >
                      {isMine ? "Você" : "Aluno"}
                    </span>
                    <div
                      className={cn(
                        "rounded-2xl px-3 py-2",
                        isMine
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100 rounded-bl-sm"
                      )}
                    >
                      {msg.video_url ? (
                        <video
                          src={msg.video_url}
                          controls
                          preload="metadata"
                          className="rounded-lg max-w-[220px] max-h-[160px]"
                        />
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{msg.mensagem}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                      {format(new Date(msg.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleVideoUploadAdmin(file);
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mensagemTexto.trim()) sendMensagemAdmin.mutate();
            }}
            className="flex items-center gap-2 pt-2"
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={uploadingVideo}
              onClick={() => videoInputRef.current?.click()}
              title="Anexar vídeo"
            >
              {uploadingVideo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            </Button>
            <Input
              placeholder="Responder..."
              value={mensagemTexto}
              onChange={(e) => setMensagemTexto(e.target.value)}
              className="flex-1"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!mensagemTexto.trim() || sendMensagemAdmin.isPending}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Editar Usuário
            </DialogTitle>
            <DialogDescription>Altere o nome, email ou tipo do usuário.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                  className="pl-10"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Edite o campo para alterar o email do usuário.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Tipo de usuário</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aluno">Aluno</SelectItem>
                  <SelectItem value="professor">Professor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Academia</Label>
              <SearchableSelect
                value={editAcademiaNome}
                onValueChange={setEditAcademiaNome}
                options={academiaOptions}
                placeholder="Selecione a academia"
                onAddNew={async (nome) => {
                  await addAcademia(nome);
                }}
                addNewLabel="Adicionar academia"
              />
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSendResetEmail}
              disabled={sendingReset}
            >
              {sendingReset ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando...</>
              ) : (
                <><KeyRound className="h-4 w-4 mr-2" />Enviar email de redefinição de senha</>
              )}
            </Button>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleEditUser} disabled={editSaving}>
                {editSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : "Salvar"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteUser?.full_name}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Excluindo...</> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
