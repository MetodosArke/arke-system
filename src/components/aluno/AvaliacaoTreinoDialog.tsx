import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * Avaliação do treino que acabou — do app original, trazida em 23/09/2026.
 *
 * Duas perguntas e uma observação, respondidas de pé, ainda na academia. O
 * esforço percebido é o que dá sentido à carga: sem ele, "não subiu o peso"
 * pode significar que está fácil demais ou que o aluno está no limite, e o
 * professor não tem como distinguir olhando só os números.
 *
 * "Dor" é uma das sensações e **não tira ponto** — a diretriz de gamificação
 * positiva do projeto diz que relato de dor nunca pune. Ela é um sinal para a
 * equipe, não uma falta.
 *
 * Nada aqui é obrigatório: o aluno pode fechar e o treino continua registrado.
 * Exigir resposta faria o registro depender de paciência no fim do treino, que
 * é exatamente quando ela acabou.
 */

const SENSACOES = [
  { valor: "otimo", rotulo: "Ótimo", emoji: "💪" },
  { valor: "bom", rotulo: "Bom", emoji: "🙂" },
  { valor: "regular", rotulo: "Regular", emoji: "😐" },
  { valor: "dificil", rotulo: "Difícil", emoji: "😮‍💨" },
  { valor: "dor", rotulo: "Senti dor", emoji: "⚠️" },
] as const;

export function AvaliacaoTreinoDialog({
  aberto,
  onOpenChange,
  registroId,
  todasFeitas,
  duracaoMin,
  onConcluido,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  registroId: string;
  todasFeitas: boolean;
  duracaoMin: number;
  onConcluido: () => void;
}) {
  const { toast } = useToast();
  const [esforco, setEsforco] = useState<number | null>(null);
  const [sensacao, setSensacao] = useState<string | null>(null);
  const [observacao, setObservacao] = useState("");

  const concluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("registro_treino")
        .update({
          // `concluido` reflete o que de fato aconteceu: encerrar com metade
          // das séries é um treino parcial, e marcá-lo como completo estragaria
          // a constância — a métrica que a academia usa para falar com o aluno.
          concluido: todasFeitas,
          esforco_percebido: esforco,
          sensacao,
          duracao_min: duracaoMin,
          observacao: observacao.trim() || null,
        })
        .eq("id", registroId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: todasFeitas ? "Treino concluído!" : "Treino registrado",
        description: todasFeitas ? "Bom trabalho hoje." : "As séries que você fez ficaram registradas.",
      });
      onOpenChange(false);
      onConcluido();
    },
    onError: (e: Error) =>
      toast({ title: "Não foi possível encerrar", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{todasFeitas ? "Treino completo!" : "Encerrar treino"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Como foi o esforço? (1 leve — 10 máximo)</Label>
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Esforço ${n}`}
                  aria-pressed={esforco === n}
                  onClick={() => setEsforco(esforco === n ? null : n)}
                  className={`h-9 rounded-md border text-sm font-medium transition-colors ${
                    esforco === n ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Como você se sentiu?</Label>
            <div className="flex flex-wrap gap-1.5">
              {SENSACOES.map((s) => (
                <button
                  key={s.valor}
                  type="button"
                  aria-pressed={sensacao === s.valor}
                  onClick={() => setSensacao(sensacao === s.valor ? null : s.valor)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    sensacao === s.valor ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                  }`}
                >
                  {s.emoji} {s.rotulo}
                </button>
              ))}
            </div>
            {sensacao === "dor" && (
              <p className="text-xs text-muted-foreground">
                Registrar dor não tira ponto nenhum. A equipe da academia vê isso e fala com você antes do próximo treino.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="obs-treino" className="text-xs">
              Quer contar mais alguma coisa? (opcional)
            </Label>
            <Textarea
              id="obs-treino"
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ombro incomodou na terceira série, aumentei o supino..."
            />
          </div>

          <p className="text-xs text-muted-foreground">Duração registrada: {duracaoMin} min</p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Voltar ao treino
          </Button>
          <Button disabled={concluir.isPending} onClick={() => concluir.mutate()}>
            {concluir.isPending ? "Salvando..." : "Encerrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
