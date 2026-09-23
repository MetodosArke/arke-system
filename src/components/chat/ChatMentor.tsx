import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { mensagemDeErroEdge } from "@/lib/erroEdge";

/**
 * Canal do aluno do Método ARKE com o mentor da ArkeFit.
 *
 * Componente próprio, e não mais um `type` do `ChatPanel`, por uma razão de
 * risco: o ChatPanel é tipado por tabela (mensagens_treino e mensagens_dieta
 * têm remetentes diferentes) e carrega vídeo, resolução de dieta ativa e push.
 * Enfiar uma terceira tabela ali espalharia condicional por toda a função e
 * colocaria dois canais que funcionam sob risco de regressão. A estrutura do
 * chat é a mesma — a mesma lista, a mesma marcação de lida, o mesmo formato de
 * bolha; o que muda é a tabela por trás.
 *
 * **A academia não lê este canal**, nem aqui nem no banco: `mensagens_mentor`
 * não tem `is_org_staff` na regra de leitura. É o que permite ao aluno falar
 * do que não contaria ao professor da própria academia.
 */

interface MensagemMentor {
  id: string;
  remetente_tipo: "aluno" | "mentor";
  mensagem: string;
  lida: boolean;
  created_at: string;
}

export function ChatMentor({
  organizationId,
  alunoId,
  viewerType,
  className,
}: {
  organizationId: string;
  alunoId: string;
  /** "aluno" no app do aluno; "mentor" na Visão Master da ArkeFit. */
  viewerType: "aluno" | "mentor";
  className?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  // A sugestao do Sentinela e um RASCUNHO: entra no campo para o mentor
  // editar ou apagar, e nunca vira mensagem sozinha. E o unico controle que
  // de fato impede a deriva para conselho tecnico — e ele e humano.
  const [sugestaoId, setSugestaoId] = useState<string | null>(null);
  const [sugestaoOriginal, setSugestaoOriginal] = useState("");
  const fimRef = useRef<HTMLDivElement>(null);

  const meuTipo: "aluno" | "mentor" = viewerType;

  const { data: mensagens = [] } = useQuery({
    queryKey: ["chat-mentor", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens_mentor")
        .select("id, remetente_tipo, mensagem, lida, created_at")
        .eq("aluno_id", alunoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MensagemMentor[];
    },
    enabled: !!alunoId,
    refetchInterval: 20_000,
  });

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens.length]);

  // Marca como lidas as mensagens do outro lado. Sem isto a fila da Visão
  // Master mostraria para sempre a mesma conversa como "esperando resposta".
  useEffect(() => {
    const doOutro = mensagens.filter((m) => m.remetente_tipo !== meuTipo && !m.lida).map((m) => m.id);
    if (!doOutro.length) return;
    void supabase
      .from("mensagens_mentor")
      .update({ lida: true })
      .in("id", doOutro)
      .then(() => queryClient.invalidateQueries({ queryKey: ["fila-mentor"] }));
  }, [mensagens, meuTipo, queryClient]);

  const sugerir = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("mentor-sugerir-resposta", {
        body: { aluno_id: alunoId },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível falar com o Sentinela."));
      return data as { sugestao?: string; sugestao_id?: string; indisponivel?: boolean; motivo?: string };
    },
    onSuccess: (d) => {
      // Sentinela indisponível não é erro do mentor: ele segue escrevendo
      // como antes de existir sugestão. Falha aberta, de propósito.
      if (d.indisponivel || !d.sugestao) {
        toast({ title: "Sem sugestão agora", description: d.motivo ?? "Tente de novo em instantes." });
        return;
      }
      setTexto(d.sugestao);
      setSugestaoOriginal(d.sugestao);
      setSugestaoId(d.sugestao_id ?? null);
    },
    onError: (e: Error) => toast({ title: "Sem sugestão agora", description: e.message }),
  });

  const enviar = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão inválida.");
      const { error } = await supabase.from("mensagens_mentor").insert({
        organization_id: organizationId,
        aluno_id: alunoId,
        remetente_id: user.id,
        remetente_tipo: meuTipo,
        mensagem: texto.trim(),
      });
      if (error) throw error;

      // O desfecho da sugestao e a medida de valor do Sentinela: se o mentor
      // reescreve tudo, o recurso atrapalha mais do que ajuda. "Editada"
      // conta como aproveitada — o modelo poupou o comeco do trabalho.
      if (sugestaoId) {
        await supabase
          .from("sentinela_sugestoes")
          .update({
            desfecho: texto.trim() === sugestaoOriginal.trim() ? "aceita" : "editada",
            respondido_em: new Date().toISOString(),
          })
          .eq("id", sugestaoId);
      }
    },
    onSuccess: () => {
      setTexto("");
      setSugestaoId(null);
      setSugestaoOriginal("");
      void queryClient.invalidateQueries({ queryKey: ["chat-mentor", alunoId] });
      void queryClient.invalidateQueries({ queryKey: ["fila-mentor"] });
    },
    onError: (e: Error) =>
      toast({ title: "Não foi possível enviar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex-1 space-y-2 overflow-y-auto max-h-[420px] pr-1">
        {mensagens.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {viewerType === "aluno"
              ? "Seu mentor ARKE acompanha sua jornada por aqui. Mande a primeira mensagem."
              : "Nenhuma mensagem ainda nesta conversa."}
          </p>
        )}
        {mensagens.map((m) => {
          const minha = m.remetente_tipo === meuTipo;
          return (
            <div key={m.id} className={cn("flex", minha ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  minha ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.mensagem}</p>
                <p className={cn("mt-0.5 text-[10px]", minha ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {m.remetente_tipo === "mentor" ? "Mentor ARKE · " : ""}
                  {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      {viewerType === "mentor" && (
        <div className="flex items-center gap-2 pt-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={sugerir.isPending}
            onClick={() => sugerir.mutate()}
          >
            {sugerir.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Sugerir resposta
          </Button>
          {sugestaoId && (
            <span className="text-[11px] text-muted-foreground">
              Rascunho do Sentinela — revise antes de enviar.
            </span>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim()) enviar.mutate();
        }}
        className="flex items-center gap-2 pt-2"
      >
        <Input
          placeholder="Escrever mensagem..."
          aria-label="Mensagem para o mentor"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={!texto.trim() || enviar.isPending} aria-label="Enviar">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
