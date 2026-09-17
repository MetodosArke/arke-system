import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  UtensilsCrossed,
  Search,
  Pencil,
  Plus,
  Trash2,
  FileText,
  Upload,
  Download,
  Eye,
  X,
  MessageCircle,
  Send,
} from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { sendChatPush } from "@/lib/sendChatPush";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export default function AdminDietas() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAluno, setSelectedAluno] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [filterAluno, setFilterAluno] = useState<string>("all");
  const [msgDialogOpen, setMsgDialogOpen] = useState(false);
  const [msgDieta, setMsgDieta] = useState<any>(null);
  const [mensagemTexto, setMensagemTexto] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDieta, setEditDieta] = useState<any>(null);
  const [editTitulo, setEditTitulo] = useState("");
  const [editDescricao, setEditDescricao] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editUploading, setEditUploading] = useState(false);
  const [editRemoveFile, setEditRemoveFile] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-alunos-dieta"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, status")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: dietas = [], isLoading } = useQuery({
    queryKey: ["admin-dietas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dietas")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Messages for selected diet
  const { data: mensagens = [] } = useQuery({
    queryKey: ["admin-mensagens-dieta", msgDieta?.id],
    queryFn: async () => {
      if (!msgDieta?.id) return [];
      const { data, error } = await supabase
        .from("mensagens_dieta" as any)
        .select("*")
        .eq("dieta_id", msgDieta.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!msgDieta?.id,
  });

  const sendMensagemAdmin = useMutation({
    mutationFn: async () => {
      if (!user?.id || !msgDieta?.id || !mensagemTexto.trim()) return;
      const { error } = await supabase
        .from("mensagens_dieta" as any)
        .insert({
          dieta_id: msgDieta.id,
          aluno_id: msgDieta.aluno_id,
          remetente_id: user.id,
          remetente_tipo: 'nutricionista',
          mensagem: mensagemTexto.trim(),
        } as any);
      if (error) throw error;
      void sendChatPush({
        recipientUserId: msgDieta.aluno_id,
        title: "Nova mensagem da nutricionista",
        body: mensagemTexto.trim().slice(0, 140),
        url: "/#/app/dieta",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-mensagens-dieta"] });
      setMensagemTexto("");
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  const uploadDieta = useMutation({
    mutationFn: async () => {
      if (!file || !selectedAluno || !titulo) throw new Error("Preencha todos os campos obrigatórios");

      setUploading(true);
      const fileExt = file.name.split(".").pop();
      const filePath = `${selectedAluno}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("dietas")
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/dietas/${filePath}`;

      const { error: insertError } = await supabase.from("dietas").insert({
        aluno_id: selectedAluno,
        titulo,
        descricao: descricao || null,
        arquivo_url: publicUrl,
        criado_por: user?.id || null,
      } as any);
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-dietas"] });
      toast({ title: "Dieta enviada com sucesso!" });
      setDialogOpen(false);
      setSelectedAluno("");
      setTitulo("");
      setDescricao("");
      setFile(null);
      setUploading(false);
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
      setUploading(false);
    },
  });

  const deleteDieta = useMutation({
    mutationFn: async (dieta: { id: string; arquivo_url: string | null }) => {
      if (dieta.arquivo_url) {
        const path = dieta.arquivo_url.split("/dietas/")[1];
        if (path) {
          await supabase.storage.from("dietas").remove([path]);
        }
      }
      const { error } = await supabase.from("dietas").delete().eq("id", dieta.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-dietas"] });
      toast({ title: "Dieta removida!" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const updateDieta = useMutation({
    mutationFn: async () => {
      if (!editDieta || !editTitulo) throw new Error("Preencha o título");
      setEditUploading(true);

      let arquivoUrl = editDieta.arquivo_url;

      // Remove existing file if flagged
      if (editRemoveFile && editDieta.arquivo_url) {
        const oldPath = editDieta.arquivo_url.split("/dietas/")[1];
        if (oldPath) await supabase.storage.from("dietas").remove([oldPath]);
        arquivoUrl = null;
      }

      if (editFile) {
        // Remove old file if replacing
        if (editDieta.arquivo_url && !editRemoveFile) {
          const oldPath = editDieta.arquivo_url.split("/dietas/")[1];
          if (oldPath) await supabase.storage.from("dietas").remove([oldPath]);
        }
        const fileExt = editFile.name.split(".").pop();
        const filePath = `${editDieta.aluno_id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from("dietas").upload(filePath, editFile);
        if (uploadError) throw uploadError;
        arquivoUrl = `${SUPABASE_URL}/storage/v1/object/public/dietas/${filePath}`;
      }

      const { error } = await supabase
        .from("dietas")
        .update({
          titulo: editTitulo,
          descricao: editDescricao || null,
          arquivo_url: arquivoUrl,
        } as any)
        .eq("id", editDieta.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-dietas"] });
      toast({ title: "Dieta atualizada!" });
      setEditDialogOpen(false);
      setEditDieta(null);
      setEditFile(null);
      setEditRemoveFile(false);
      setEditUploading(false);
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
      setEditUploading(false);
    },
  });

  const openEditDialog = (dieta: any) => {
    setEditDieta(dieta);
    setEditTitulo(dieta.titulo);
    setEditDescricao(dieta.descricao || "");
    setEditFile(null);
    setEditRemoveFile(false);
    setEditDialogOpen(true);
  };

  const getAlunoName = (alunoId: string) => {
    const aluno = alunos.find((a) => a.user_id === alunoId);
    return aluno?.full_name || "Aluno desconhecido";
  };

  const filtered = dietas.filter((d) => {
    const matchesSearch =
      d.titulo.toLowerCase().includes(search.toLowerCase()) ||
      getAlunoName(d.aluno_id).toLowerCase().includes(search.toLowerCase());
    const matchesAluno = filterAluno === "all" || d.aluno_id === filterAluno;
    return matchesSearch && matchesAluno;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Dietas</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Gerencie os planos alimentares dos alunos
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Enviar Nova Dieta
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Enviar Nova Dieta</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Selecionar Cliente *</Label>
                <Select value={selectedAluno} onValueChange={setSelectedAluno}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o aluno" />
                  </SelectTrigger>
                  <SelectContent>
                    {alunos.map((a) => (
                      <SelectItem key={a.user_id} value={a.user_id}>
                        {a.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Título da Dieta *</Label>
                <Input
                  placeholder="Ex: Plano Alimentar - Fase 1"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  placeholder="Descrição opcional da dieta..."
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Arquivo PDF *</Label>
                <div className="relative">
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="diet-file-input"
                  />
                  <label
                    htmlFor="diet-file-input"
                    className="flex items-center gap-3 rounded-lg border-2 border-dashed border-border p-4 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  >
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      {file ? (
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary shrink-0" />
                          <span className="text-sm font-medium truncate">
                            {file.name}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={(e) => {
                              e.preventDefault();
                              setFile(null);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium">Escolher arquivo</p>
                          <p className="text-xs text-muted-foreground">
                            Apenas arquivos PDF são aceitos
                          </p>
                        </>
                      )}
                    </div>
                  </label>
                </div>
              </div>
            </div>
            <DialogFooter className="flex-row gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => uploadDieta.mutate()}
                disabled={!selectedAluno || !titulo || !file || uploading}
                className="gap-2"
              >
                {uploading ? (
                  "Enviando..."
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Enviar Dieta
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar dieta..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterAluno} onValueChange={setFilterAluno}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filtrar por aluno" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os alunos</SelectItem>
            {alunos.map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>
                {a.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Diet list */}
      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UtensilsCrossed className="h-5 w-5 text-primary" />
            Gerenciar Dietas ({filtered.length})
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
              <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                Nenhuma dieta encontrada
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((dieta) => (
                <div
                  key={dieta.id}
                  className="flex items-center justify-between rounded-lg bg-muted/30 px-3 sm:px-4 py-3 hover:bg-muted/50 transition-colors gap-2"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 shrink-0">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {dieta.titulo}
                      </p>
                      {(dieta as any).descricao && (
                        <p className="text-xs text-muted-foreground truncate">
                          {(dieta as any).descricao}
                         </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <Badge variant="outline" className="text-xs">
                          {getAlunoName(dieta.aluno_id)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(dieta.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </span>
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-0 text-xs">
                          Ativa
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditDialog(dieta)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setMsgDieta(dieta);
                        setMsgDialogOpen(true);
                      }}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </Button>
                    {dieta.arquivo_url && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(dieta.arquivo_url!, "_blank")}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        deleteDieta.mutate({
                          id: dieta.id,
                          arquivo_url: dieta.arquivo_url,
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Dieta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Aluno</Label>
              <Input value={editDieta ? getAlunoName(editDieta.aluno_id) : ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input
                value={editTitulo}
                onChange={(e) => setEditTitulo(e.target.value)}
                placeholder="Título da dieta"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={editDescricao}
                onChange={(e) => setEditDescricao(e.target.value)}
                placeholder="Descrição opcional..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Arquivo</Label>

              {/* Current file preview */}
              {editDieta?.arquivo_url && !editRemoveFile && !editFile && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate flex-1">
                    Arquivo atual
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => window.open(editDieta.arquivo_url!, "_blank")}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setEditRemoveFile(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {/* Removed notice */}
              {editRemoveFile && !editFile && (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <span className="text-sm text-muted-foreground flex-1">Arquivo será removido</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setEditRemoveFile(false)}
                  >
                    Desfazer
                  </Button>
                </div>
              )}

              {/* Upload new / replace */}
              <div className="relative">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    setEditFile(e.target.files?.[0] || null);
                    if (e.target.files?.[0]) setEditRemoveFile(false);
                  }}
                  className="hidden"
                  id="edit-diet-file-input"
                />
                {editFile ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">{editFile.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setEditFile(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <label
                    htmlFor="edit-diet-file-input"
                    className="flex items-center gap-3 rounded-lg border-2 border-dashed border-border p-3 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  >
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {editDieta?.arquivo_url && !editRemoveFile
                        ? "Substituir arquivo"
                        : "Enviar novo arquivo"}
                    </p>
                  </label>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => updateDieta.mutate()}
              disabled={!editTitulo || editUploading}
            >
              {editUploading ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Messages Dialog */}
      <Dialog open={msgDialogOpen} onOpenChange={setMsgDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              Mensagens - {msgDieta?.titulo}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {msgDieta && getAlunoName(msgDieta.aluno_id)}
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 rounded-lg bg-muted/20 p-3 min-h-[200px] max-h-[400px]">
            {mensagens.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma mensagem ainda.
              </p>
            ) : (
              mensagens.map((msg: any) => {
                const isMine = msg.remetente_tipo === 'nutricionista';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-[80%] ${
                      isMine ? "ml-auto items-end" : "mr-auto items-start"
                    }`}
                  >
                    <span className={`text-[10px] font-semibold mb-0.5 px-1 ${
                      isMine ? "text-primary" : "text-emerald-600"
                    }`}>
                      {isMine ? "Você" : "Aluno"}
                    </span>
                    <div
                      className={`rounded-2xl px-3 py-2 ${
                        isMine
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100 rounded-bl-sm"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.mensagem}</p>
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mensagemTexto.trim()) sendMensagemAdmin.mutate();
            }}
            className="flex items-center gap-2 pt-2"
          >
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
    </motion.div>
  );
}
