import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageCircle, Dumbbell, UtensilsCrossed } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useCaixaMensagens, type ConversaCaixa } from "@/hooks/useCaixaMensagens";
import { cn } from "@/lib/utils";

type Filtro = "todas" | "nao_lidas" | "treino" | "dieta";

// Caixa de mensagens da equipe: as conversas de treino e de dieta de todos os
// alunos num lugar só, com as não lidas primeiro. Responder abre o mesmo chat
// da ficha do aluno, que marca as mensagens como lidas ao abrir.
export default function AdminMensagens() {
  const { organization } = useAuth();
  const queryClient = useQueryClient();
  const { conversas, naoLidas, canais, isLoading, error } = useCaixaMensagens();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [aberta, setAberta] = useState<ConversaCaixa | null>(null);

  const visiveis = conversas.filter((c) => {
    if (filtro === "nao_lidas") return c.nao_lidas > 0;
    if (filtro === "treino" || filtro === "dieta") return c.canal === filtro;
    return true;
  });

  const filtros: { valor: Filtro; rotulo: string }[] = [
    { valor: "todas", rotulo: "Todas" },
    { valor: "nao_lidas", rotulo: `Não lidas${naoLidas ? ` (${naoLidas})` : ""}` },
    ...(canais.length > 1
      ? [
          { valor: "treino" as const, rotulo: "Treino" },
          { valor: "dieta" as const, rotulo: "Dieta" },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageCircle className="h-6 w-6 text-primary" /> Mensagens
        </h1>
        <p className="text-sm text-muted-foreground">
          Conversas dos alunos com a equipe. As não lidas ficam no topo.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {filtros.map((f) => (
          <Button key={f.valor} size="sm" variant={filtro === f.valor ? "default" : "outline"} onClick={() => setFiltro(f.valor)}>
            {f.rotulo}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{visiveis.length} conversa(s)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
          {error && <p className="p-4 text-sm text-destructive">Não foi possível carregar as mensagens.</p>}
          {!isLoading && !error && visiveis.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground text-center">
              {filtro === "nao_lidas" ? "Nenhuma mensagem esperando resposta." : "Nenhuma conversa ainda."}
            </p>
          )}
          <ul className="divide-y divide-border">
            {visiveis.map((c) => {
              const Icone = c.canal === "treino" ? Dumbbell : UtensilsCrossed;
              return (
                <li key={`${c.aluno_id}-${c.canal}`}>
                  <button
                    className={cn("w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex gap-3", c.nao_lidas > 0 && "bg-primary/5")}
                    onClick={() => setAberta(c)}
                  >
                    <Icone className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm truncate", c.nao_lidas > 0 ? "font-semibold" : "font-medium")}>{c.aluno_nome}</p>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(c.ultima_em), { addSuffix: true, locale: ptBR })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.ultimo_remetente === "aluno" ? "" : "Você/equipe: "}
                        {c.ultima_mensagem}
                      </p>
                    </div>
                    {c.nao_lidas > 0 && <Badge className="self-center shrink-0">{c.nao_lidas}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Dialog
        open={!!aberta}
        onOpenChange={(open) => {
          if (!open) {
            setAberta(null);
            void queryClient.invalidateQueries({ queryKey: ["caixa-mensagens"] });
          }
        }}
      >
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {aberta?.canal === "treino" ? "Chat Treino" : "Chat Nutrição"} — {aberta?.aluno_nome}
            </DialogTitle>
          </DialogHeader>
          {aberta && organization && (
            <ChatPanel
              organizationId={organization.id}
              alunoId={aberta.aluno_id}
              viewerType="staff"
              type={aberta.canal === "treino" ? "treino" : "nutri"}
              dietaId={aberta.dieta_id ?? undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
