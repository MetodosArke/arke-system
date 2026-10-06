import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** O texto do pedido de nota, num lugar só. */
export const PERGUNTA_AVALIACAO = "Como foi o atendimento?";

/**
 * O pedido de nota do chamado encerrado, para quem o abriu: de 1 a 5, com um
 * comentário opcional, uma vez. A gravação é `avaliar_atendimento()`, que
 * confere de novo quem avalia e recusa em perfil simulado. É a avaliação
 * regular da qualidade do atendimento que o Asaas acompanha no BaaS.
 */
export function AvaliarAtendimento({ chamadoId, aoAvaliar }: { chamadoId: string; aoAvaliar: () => void }) {
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const enviar = useMutation({
    mutationFn: async (dados: { nota: number; comentario: string }) => {
      const { error } = await supabase.rpc("avaliar_atendimento", {
        _chamado_id: chamadoId,
        _nota: dados.nota,
        _comentario: dados.comentario.trim() || undefined,
      });
      if (error) throw new Error(error.message);
    },
    onMutate: () => setErro(null),
    onSuccess: aoAvaliar,
    onError: (e: Error) => setErro(e.message),
  });

  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border p-2" role="group" aria-label={PERGUNTA_AVALIACAO}>
      <p className="text-xs font-medium">{PERGUNTA_AVALIACAO}</p>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Nota de 1 a 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={nota === n}
            aria-label={`${n} de 5`}
            onClick={() => setNota(n)}
            className="rounded p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Star className={cn("h-5 w-5", nota !== null && n <= nota ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
          </button>
        ))}
      </div>
      {nota !== null && (
        <>
          <Textarea
            aria-label="Comentário (opcional)"
            placeholder="Quer contar mais? (opcional)"
            maxLength={1000}
            rows={2}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            className="text-xs"
          />
          <Button size="sm" disabled={enviar.isPending} onClick={() => enviar.mutate({ nota, comentario })}>
            {enviar.isPending ? "Enviando..." : "Enviar avaliação"}
          </Button>
        </>
      )}
      {erro && (
        <p role="alert" className="text-xs text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
