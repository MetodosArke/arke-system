import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Dumbbell, UtensilsCrossed, Video, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { sendChatPush } from "@/lib/sendChatPush";

interface AdminChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alunoId: string;
  alunoName: string;
  type: "treino" | "nutri";
  dietaId?: string; // required for nutri type
}

export function AdminChatDialog({ open, onOpenChange, alunoId, alunoName, type, dietaId }: AdminChatDialogProps) {
  const [mensagemTexto, setMensagemTexto] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // For nutri chat, we need a dietaId. If not provided, fetch latest dieta for this aluno.
  const { data: resolvedDietaId } = useQuery({
    queryKey: ["resolve-dieta-id", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("dietas")
        .select("id")
        .eq("aluno_id", alunoId)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0]?.id || null;
    },
    enabled: type === "nutri" && !dietaId && open,
  });

  const activeDietaId = dietaId || resolvedDietaId;

  // Treino messages
  const { data: mensagensTreino = [] } = useQuery({
    queryKey: ["chat-treino-msgs", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("mensagens_treino" as any)
        .select("*")
        .eq("aluno_id", alunoId)
        .order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: type === "treino" && open,
  });

  // Nutri messages
  const { data: mensagensNutri = [] } = useQuery({
    queryKey: ["chat-nutri-msgs", activeDietaId],
    queryFn: async () => {
      if (!activeDietaId) return [];
      const { data } = await supabase
        .from("mensagens_dieta" as any)
        .select("*")
        .eq("dieta_id", activeDietaId)
        .order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: type === "nutri" && open && !!activeDietaId,
  });

  const mensagens = type === "treino" ? mensagensTreino : mensagensNutri;
  const myType = type === "treino" ? "treinador" : "nutricionista";

  const sendMsg = useMutation({
    mutationFn: async () => {
      if (!user?.id || !mensagemTexto.trim()) return;
      if (type === "treino") {
        await supabase.from("mensagens_treino" as any).insert({
          aluno_id: alunoId,
          remetente_id: user.id,
          remetente_tipo: "treinador",
          mensagem: mensagemTexto.trim(),
        } as any);
        void sendChatPush({
          recipientUserId: alunoId,
          title: "Nova mensagem do seu treinador",
          body: mensagemTexto.trim().slice(0, 140),
          url: "/#/app/treinos",
        });
      } else {
        if (!activeDietaId) return;
        await supabase.from("mensagens_dieta" as any).insert({
          dieta_id: activeDietaId,
          aluno_id: alunoId,
          remetente_id: user.id,
          remetente_tipo: "nutricionista",
          mensagem: mensagemTexto.trim(),
        } as any);
        void sendChatPush({
          recipientUserId: alunoId,
          title: "Nova mensagem da nutricionista",
          body: mensagemTexto.trim().slice(0, 140),
          url: "/#/app/dieta",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: type === "treino" ? ["chat-treino-msgs"] : ["chat-nutri-msgs"] });
      queryClient.invalidateQueries({ queryKey: ["admin-dash-msgs-treino"] });
      queryClient.invalidateQueries({ queryKey: ["admin-dash-msgs-dieta"] });
      queryClient.invalidateQueries({ queryKey: ["header-msgs-treino"] });
      queryClient.invalidateQueries({ queryKey: ["header-msgs-dieta"] });
      setMensagemTexto("");
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  const handleVideoUpload = async (file: File) => {
    if (!user?.id || type !== "treino") return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Vídeo muito grande", description: "Máximo 10MB.", variant: "destructive" });
      return;
    }
    setUploadingVideo(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("chat-videos").upload(path, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("chat-videos").getPublicUrl(path);
      await supabase.from("mensagens_treino" as any).insert({
        aluno_id: alunoId,
        remetente_id: user.id,
        remetente_tipo: "treinador",
        mensagem: "📹 Vídeo",
        video_url: urlData.publicUrl,
      } as any);
      void sendChatPush({
        recipientUserId: alunoId,
        title: "Nova mensagem do seu treinador",
        body: "📹 Vídeo enviado",
        url: "/#/app/treinos",
      });
      queryClient.invalidateQueries({ queryKey: ["chat-treino-msgs"] });
    } catch (err: any) {
      toast({ title: "Erro ao enviar vídeo", description: err.message, variant: "destructive" });
    } finally {
      setUploadingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  // Marcar mensagens do aluno como lidas quando o admin abre o chat
  useEffect(() => {
    if (!open) return;
    const markAsRead = async () => {
      if (type === "treino") {
        const { error } = await supabase
          .from("mensagens_treino" as any)
          .update({ lida: true } as any)
          .eq("aluno_id", alunoId)
          .eq("remetente_tipo", "aluno")
          .eq("lida", false);
        if (!error) {
          queryClient.invalidateQueries({ queryKey: ["chat-treino-msgs"] });
          queryClient.invalidateQueries({ queryKey: ["admin-dash-msgs-treino"] });
          queryClient.invalidateQueries({ queryKey: ["header-msgs-treino"] });
        }
      } else {
        if (!activeDietaId) return;
        const { error } = await supabase
          .from("mensagens_dieta" as any)
          .update({ lida: true } as any)
          .eq("dieta_id", activeDietaId)
          .eq("remetente_tipo", "aluno")
          .eq("lida", false);
        if (!error) {
          queryClient.invalidateQueries({ queryKey: ["chat-nutri-msgs"] });
          queryClient.invalidateQueries({ queryKey: ["admin-dash-msgs-dieta"] });
          queryClient.invalidateQueries({ queryKey: ["header-msgs-dieta"] });
        }
      }
    };
    void markAsRead();
  }, [open, type, alunoId, activeDietaId, queryClient]);

  const Icon = type === "treino" ? Dumbbell : UtensilsCrossed;
  const title = type === "treino" ? `Chat Treino - ${alunoName}` : `Chat Nutrição - ${alunoName}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 rounded-lg bg-muted/20 p-3 min-h-[200px] max-h-[400px]">
          {type === "nutri" && !activeDietaId ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma dieta cadastrada para este aluno.
            </p>
          ) : mensagens.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma mensagem ainda.
            </p>
          ) : (
            mensagens.map((msg: any) => {
              const isMine = msg.remetente_tipo === myType;
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

        {type === "treino" && (
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleVideoUpload(file);
            }}
          />
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mensagemTexto.trim()) sendMsg.mutate();
          }}
          className="flex items-center gap-2 pt-2"
        >
          {type === "treino" && (
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
          )}
          <Input
            placeholder="Responder..."
            value={mensagemTexto}
            onChange={(e) => setMensagemTexto(e.target.value)}
            className="flex-1"
            disabled={type === "nutri" && !activeDietaId}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!mensagemTexto.trim() || sendMsg.isPending}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
