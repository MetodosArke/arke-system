import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Video, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { sendChatPush } from "@/lib/sendChatPush";
import { VideoChat } from "@/components/chat/VideoChat";

interface MensagemTreino {
  id: string;
  remetente_tipo: "aluno" | "treinador";
  mensagem: string;
  video_url: string | null;
  lida: boolean;
  created_at: string;
}

interface MensagemDieta {
  id: string;
  remetente_tipo: "aluno" | "nutricionista";
  mensagem: string;
  lida: boolean;
  created_at: string;
}

interface ChatPanelProps {
  organizationId: string;
  alunoId: string;
  /** "aluno" quando renderizado dentro do app do próprio aluno; "staff" no painel administrativo. */
  viewerType: "aluno" | "staff";
  type: "treino" | "nutri";
  /** obrigatório quando type === "nutri" e viewerType === "staff" (o aluno resolve pela própria dieta ativa) */
  dietaId?: string;
  className?: string;
}

export function ChatPanel({ organizationId, alunoId, viewerType, type, dietaId, className }: ChatPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mensagemTexto, setMensagemTexto] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Tipado por chat: cada um só aceita os remetentes válidos da própria
  // tabela (mensagens_treino: aluno/treinador; mensagens_dieta:
  // aluno/nutricionista) — evita misturar os dois em `myType`, que faria o
  // TS aceitar "nutricionista" num insert de mensagens_treino e vice-versa.
  const myTypeTreino: "aluno" | "treinador" = viewerType === "aluno" ? "aluno" : "treinador";
  const myTypeNutri: "aluno" | "nutricionista" = viewerType === "aluno" ? "aluno" : "nutricionista";
  const myType: "aluno" | "treinador" | "nutricionista" = type === "treino" ? myTypeTreino : myTypeNutri;

  // Nutri: se não veio dietaId explícito (caso do aluno), resolve a dieta ativa mais recente.
  const { data: resolvedDietaId } = useQuery({
    queryKey: ["resolve-dieta-id-chat", alunoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("dietas")
        .select("id")
        .eq("aluno_id", alunoId)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0]?.id ?? null;
    },
    enabled: type === "nutri" && !dietaId,
  });

  const activeDietaId = dietaId || resolvedDietaId;

  const { data: mensagensTreino = [] } = useQuery({
    queryKey: ["chat-treino-msgs", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens_treino")
        .select("id, remetente_tipo, mensagem, video_url, lida, created_at")
        .eq("aluno_id", alunoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MensagemTreino[];
    },
    enabled: type === "treino",
  });

  const { data: mensagensNutri = [] } = useQuery({
    queryKey: ["chat-nutri-msgs", activeDietaId],
    queryFn: async () => {
      if (!activeDietaId) return [];
      const { data, error } = await supabase
        .from("mensagens_dieta")
        .select("id, remetente_tipo, mensagem, lida, created_at")
        .eq("dieta_id", activeDietaId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MensagemDieta[];
    },
    enabled: type === "nutri" && !!activeDietaId,
  });

  const mensagens: (MensagemTreino | MensagemDieta)[] = type === "treino" ? mensagensTreino : mensagensNutri;

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: type === "treino" ? ["chat-treino-msgs", alunoId] : ["chat-nutri-msgs", activeDietaId] });
  };

  const resolvePushDestino = () => {
    // Push vai pro "outro lado" da conversa: staff manda pro aluno (user_id
    // dele); aluno manda pra equipe da organização (professor/nutri/gestor).
    if (viewerType === "staff") return { recipientUserId: alunoUserIdRef.current ?? undefined };
    const roles = type === "treino" ? ["professor", "gestor", "admin_arke"] : ["nutricionista", "gestor", "admin_arke"];
    return { recipientOrgId: organizationId, recipientOrgRoles: roles };
  };

  // Resolvido de forma preguiçosa quando necessário (staff -> aluno): busca o user_id do aluno.
  const alunoUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (viewerType !== "staff") return;
    void supabase
      .from("alunos")
      .select("user_id")
      .eq("id", alunoId)
      .maybeSingle()
      .then(({ data }) => {
        alunoUserIdRef.current = data?.user_id ?? null;
      });
  }, [viewerType, alunoId]);

  const sendMsg = useMutation({
    mutationFn: async () => {
      if (!user?.id || !mensagemTexto.trim()) return;
      const texto = mensagemTexto.trim();
      if (type === "treino") {
        const { error } = await supabase.from("mensagens_treino").insert({
          organization_id: organizationId,
          aluno_id: alunoId,
          remetente_id: user.id,
          remetente_tipo: myTypeTreino,
          mensagem: texto,
        });
        if (error) throw error;
      } else {
        if (!activeDietaId) return;
        const { error } = await supabase.from("mensagens_dieta").insert({
          organization_id: organizationId,
          aluno_id: alunoId,
          dieta_id: activeDietaId,
          remetente_id: user.id,
          remetente_tipo: myTypeNutri,
          mensagem: texto,
        });
        if (error) throw error;
      }
      void sendChatPush({
        ...resolvePushDestino(),
        title: type === "treino" ? "Nova mensagem no chat de treino" : "Nova mensagem no chat de nutrição",
        body: texto.slice(0, 140),
        url: type === "treino" ? "/#/app/treinos" : "/#/app/dieta",
      });
    },
    onSuccess: () => {
      setMensagemTexto("");
      invalidar();
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao enviar", description: error.message, variant: "destructive" });
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
      // Pasta <organização>/<aluno>/: é o que as regras do bucket (privado) conferem.
      const path = `${organizationId}/${alunoId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("chat-videos").upload(path, file);
      if (uploadError) throw uploadError;
      const { error } = await supabase.from("mensagens_treino").insert({
        organization_id: organizationId,
        aluno_id: alunoId,
        remetente_id: user.id,
        remetente_tipo: myTypeTreino,
        mensagem: "📹 Vídeo",
        video_url: path,
      });
      if (error) throw error;
      void sendChatPush({
        ...resolvePushDestino(),
        title: "Novo vídeo no chat de treino",
        body: "📹 Vídeo enviado",
        url: "/#/app/treinos",
      });
      invalidar();
    } catch (err) {
      toast({
        title: "Erro ao enviar vídeo",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUploadingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  // Marca como lida as mensagens do outro lado ao abrir/visualizar o chat.
  // Ramifica cedo por `type` (em vez de misturar as duas tabelas numa
  // query só) pra manter os tipos de remetente_tipo e das colunas
  // estritos por tabela.
  useEffect(() => {
    if (type === "treino") {
      const outroTipo = myTypeTreino === "aluno" ? "treinador" : "aluno";
      const hasUnread = mensagens.some((m) => m.remetente_tipo === outroTipo && !m.lida);
      if (!hasUnread) return;
      void supabase
        .from("mensagens_treino")
        .update({ lida: true })
        .eq("remetente_tipo", outroTipo)
        .eq("lida", false)
        .eq("aluno_id", alunoId)
        .then(() => invalidar());
    } else {
      if (!activeDietaId) return;
      const outroTipo = myTypeNutri === "aluno" ? "nutricionista" : "aluno";
      const hasUnread = mensagens.some((m) => m.remetente_tipo === outroTipo && !m.lida);
      if (!hasUnread) return;
      void supabase
        .from("mensagens_dieta")
        .update({ lida: true })
        .eq("remetente_tipo", outroTipo)
        .eq("lida", false)
        .eq("dieta_id", activeDietaId)
        .then(() => invalidar());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex-1 overflow-y-auto space-y-2 rounded-lg bg-muted/20 p-3 min-h-[200px] max-h-[380px]">
        {type === "nutri" && !activeDietaId ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma dieta cadastrada ainda.</p>
        ) : mensagens.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda.</p>
        ) : (
          mensagens.map((msg) => {
            const isMine = msg.remetente_tipo === myType;
            const isStaffMsg = msg.remetente_tipo !== "aluno";
            return (
              <div key={msg.id} className={cn("flex flex-col max-w-[80%]", isMine ? "ml-auto items-end" : "mr-auto items-start")}>
                <span className={cn("text-[10px] font-semibold mb-0.5 px-1", isStaffMsg ? "text-primary" : "text-emerald-600")}>
                  {isMine ? "Você" : isStaffMsg ? (type === "treino" ? "Treinador(a)" : "Nutricionista") : "Aluno"}
                </span>
                <div
                  className={cn(
                    "rounded-2xl px-3 py-2",
                    isMine
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100 rounded-bl-sm"
                  )}
                >
                  {"video_url" in msg && msg.video_url ? (
                    <VideoChat referencia={msg.video_url} />
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
            if (file) void handleVideoUpload(file);
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
          placeholder="Escrever mensagem..."
          value={mensagemTexto}
          onChange={(e) => setMensagemTexto(e.target.value)}
          className="flex-1"
          disabled={type === "nutri" && !activeDietaId}
        />
        <Button type="submit" size="icon" disabled={!mensagemTexto.trim() || sendMsg.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
