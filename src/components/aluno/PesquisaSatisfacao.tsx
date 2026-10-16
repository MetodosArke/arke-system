import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { ThumbsUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { emPerfilSimulado } from "@/lib/impersonation";
import { devePerguntar } from "@/lib/pesquisaSatisfacao";

const NOTAS = Array.from({ length: 11 }, (_, i) => i);

/**
 * A pesquisa de satisfação (NPS) na home do aluno, abaixo da Próxima Ação e
 * nunca no lugar dela: a Próxima Ação é única e fica com o que o aluno precisa
 * fazer. Aparece só quando `devePerguntar` diz que é a hora; com a consulta
 * falhando, simplesmente não aparece (não há nada que o aluno perca).
 *
 * A opinião é do aluno: em perfil simulado o cartão não aparece, e o banco
 * recusa a resposta.
 */
export function PesquisaSatisfacao() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const chave = ["aluno-pesquisa-satisfacao", alunoId];

  const { data: perguntar = false } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pesquisa_satisfacao_do_aluno", { _aluno_id: alunoId! });
      if (error) throw error;
      const e = data?.[0];
      return (
        !!e &&
        devePerguntar(
          {
            liberado: e.liberado,
            dataMatricula: e.data_matricula,
            ultimaResposta: e.ultima_resposta,
            ultimoAdiamento: e.ultimo_adiamento,
          },
          hojeBrasilia(),
        )
      );
    },
    enabled: !!alunoId && !emPerfilSimulado(),
  });

  // `resposta` nula é o "Agora não".
  const enviar = useMutation({
    mutationFn: async (resposta: { nota: number; comentario: string } | null) => {
      const { error } = resposta
        ? await supabase.rpc("responder_pesquisa_satisfacao", {
            _aluno_id: alunoId!,
            _nota: resposta.nota,
            _comentario: resposta.comentario.trim() || undefined,
          })
        : await supabase.rpc("adiar_pesquisa_satisfacao", { _aluno_id: alunoId! });
      if (error) throw error;
    },
    onSuccess: (_, resposta) => {
      if (resposta) toast({ title: "Obrigado pela resposta!", description: "Ela ajuda a academia a cuidar melhor de você." });
      void queryClient.invalidateQueries({ queryKey: chave });
    },
    onError: (error: Error & { code?: string }) => {
      toast({
        title: "Não foi possível enviar",
        // A recusa nossa (P0001) diz o porquê; o resto, não.
        description: error.code === "P0001" ? error.message : "Tente de novo em instantes.",
        variant: "destructive",
      });
    },
  });

  if (!perguntar || !organization) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle id="pesquisa-satisfacao-pergunta" className="flex items-start gap-2 text-base">
          <ThumbsUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          De 0 a 10, quanto você recomendaria a {organization.nome} a um amigo?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <RadioGroupPrimitive.Root
          aria-labelledby="pesquisa-satisfacao-pergunta"
          aria-describedby="pesquisa-satisfacao-extremos"
          value={nota === null ? "" : String(nota)}
          onValueChange={(v) => setNota(Number(v))}
          className="grid grid-cols-6 gap-1.5 sm:grid-cols-11"
        >
          {NOTAS.map((n) => (
            <RadioGroupPrimitive.Item
              key={n}
              value={String(n)}
              className="h-10 rounded-md border border-border bg-background text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
            >
              {n}
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root>
        <p id="pesquisa-satisfacao-extremos" className="flex justify-between text-xs text-muted-foreground">
          <span>0: nada provável</span>
          <span>10: muito provável</span>
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="pesquisa-satisfacao-comentario">Quer contar o porquê? (opcional)</Label>
          <Textarea
            id="pesquisa-satisfacao-comentario"
            value={comentario}
            maxLength={500}
            rows={3}
            onChange={(e) => setComentario(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">A nota e o comentário vão para a gestão da {organization.nome}.</p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={enviar.isPending} onClick={() => enviar.mutate(null)}>
            Agora não
          </Button>
          <Button disabled={nota === null || enviar.isPending} onClick={() => nota !== null && enviar.mutate({ nota, comentario })}>
            {enviar.isPending ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
