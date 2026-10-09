import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ROTULO_CANAL, type CanalConversa } from "@/lib/conversaComAluno";

export type ConversaDaFila = {
  alunoId: string;
  nome: string;
  /** Os canais de `canaisDaConversaComAluno()`; nunca vazio (sem canal, não há botão). */
  canais: CanalConversa[];
};

/** O botão do cartão da fila. O nome do aluno vai no rótulo acessível: a fila tem vários "Mensagem". */
export function BotaoMensagem({ nome, onClick }: { nome: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" aria-label={`Mensagem para ${nome}`} onClick={onClick}>
      <MessageCircle className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
      Mensagem
    </Button>
  );
}

/**
 * A conversa com o aluno aberta direto da fila de atendimento: o mesmo chat
 * da ficha e da caixa de Mensagens (`ChatPanel`), sem passar pela ficha.
 * Quem atende os dois canais (a gestão, com nutricionista na equipe) troca de
 * canal aqui mesmo.
 */
export function ConversaDaFilaDialog({
  conversa,
  organizationId,
  onFechar,
}: {
  conversa: ConversaDaFila | null;
  organizationId: string | undefined;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  return (
    <Dialog
      open={!!conversa}
      onOpenChange={(open) => {
        if (open) return;
        onFechar();
        // Ler a conversa marca as mensagens como lidas: o número do menu baixa.
        void queryClient.invalidateQueries({ queryKey: ["caixa-mensagens"] });
      }}
    >
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        {conversa && organizationId && (
          <ConteudoDaConversa key={conversa.alunoId} conversa={conversa} organizationId={organizationId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConteudoDaConversa({ conversa, organizationId }: { conversa: ConversaDaFila; organizationId: string }) {
  const [canal, setCanal] = useState<CanalConversa>(conversa.canais[0]);
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {ROTULO_CANAL[canal]} — {conversa.nome}
        </DialogTitle>
      </DialogHeader>
      {conversa.canais.length > 1 && (
        <div className="flex gap-2" role="group" aria-label="Canal da conversa">
          {conversa.canais.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={c === canal ? "default" : "outline"}
              aria-pressed={c === canal}
              onClick={() => setCanal(c)}
            >
              {ROTULO_CANAL[c]}
            </Button>
          ))}
        </div>
      )}
      <ChatPanel
        key={canal}
        organizationId={organizationId}
        alunoId={conversa.alunoId}
        viewerType="staff"
        type={canal}
        className="flex-1"
      />
    </>
  );
}
