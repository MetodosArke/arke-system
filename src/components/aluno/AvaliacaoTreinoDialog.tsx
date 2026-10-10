import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { exigirGravacao } from "@/lib/gravacao";
import type { Json } from "@/integrations/supabase/types";
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
 * Sono e energia (10/10/2026, decisão do responsável): duas perguntas de 1 a 5,
 * um toque a mais, para as curvas da Evolução. Moram em
 * `registro_treino_bem_estar`, fora de `registro_treino`, porque a recepção lê
 * o registro do treino e não lê saúde. Quem retirou o consentimento de saúde
 * não recebe as duas perguntas.
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

/** Escala de 1 a 5, com os extremos escritos: um grupo de opções para o leitor de tela. */
function Escala({
  id,
  pergunta,
  nome,
  valor,
  onChange,
}: {
  id: string;
  pergunta: string;
  nome: string;
  valor: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label id={id} className="text-xs">
        {pergunta} (1 ruim — 5 ótimo)
      </Label>
      <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={valor === n}
            aria-label={`${nome} ${n}${n === 1 ? ", ruim" : n === 5 ? ", ótimo" : ""}`}
            onClick={() => onChange(valor === n ? null : n)}
            className={`h-9 rounded-md border text-sm font-medium transition-colors ${
              valor === n ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>Ruim</span>
        <span>Ótimo</span>
      </div>
    </div>
  );
}

export function AvaliacaoTreinoDialog({
  aberto,
  onOpenChange,
  registroId,
  todasFeitas,
  duracaoMin,
  detalhesExecucao,
  onConcluido,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  registroId: string;
  todasFeitas: boolean;
  duracaoMin: number;
  /** O progresso por exercício, para Meu Treino mostrar o mesmo que a execução. */
  detalhesExecucao?: Json;
  onConcluido: () => void;
}) {
  const { toast } = useToast();
  const { organization, consentimentoSaudeRetirado } = useAuth();
  const [esforco, setEsforco] = useState<number | null>(null);
  const [sensacao, setSensacao] = useState<string | null>(null);
  const [observacao, setObservacao] = useState("");
  const [sono, setSono] = useState<number | null>(null);
  const [energia, setEnergia] = useState<number | null>(null);

  const concluir = useMutation({
    mutationFn: async (r: { esforco: number | null; sensacao: string | null; observacao: string; sono: number | null; energia: number | null }) => {
      await exigirGravacao(supabase
        .from("registro_treino")
        .update({
          // `concluido` reflete o que de fato aconteceu: encerrar com metade
          // das séries é um treino parcial, e marcá-lo como completo estragaria
          // a constância — a métrica que a academia usa para falar com o aluno.
          concluido: todasFeitas,
          esforco_percebido: r.esforco,
          sensacao: r.sensacao,
          duracao_min: duracaoMin,
          observacao: r.observacao.trim() || null,
          ...(detalhesExecucao !== undefined ? { detalhes_execucao: detalhesExecucao } : {}),
        })
        .eq("id", registroId).select("id"));
      if ((r.sono != null || r.energia != null) && organization) {
        await exigirGravacao(supabase
          .from("registro_treino_bem_estar")
          .upsert({ registro_treino_id: registroId, organization_id: organization.id, sono: r.sono, energia: r.energia })
          .select("registro_treino_id"));
      }
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

          {!consentimentoSaudeRetirado && (
            <>
              <Escala id="pergunta-sono" pergunta="Como você dormiu esta noite?" nome="Sono" valor={sono} onChange={setSono} />
              <Escala id="pergunta-energia" pergunta="Como está sua energia hoje?" nome="Energia" valor={energia} onChange={setEnergia} />
            </>
          )}

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
          <Button disabled={concluir.isPending} onClick={() => concluir.mutate({ esforco, sensacao, observacao, sono, energia })}>
            {concluir.isPending ? "Salvando..." : "Encerrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
