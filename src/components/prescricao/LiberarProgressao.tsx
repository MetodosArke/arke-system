import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

/**
 * Liberar a progressão suspensa por relato de dor, na academia (16/10/2026).
 *
 * O "Senti dor" suspende a progressão até alguém liberar, e a sugestão de
 * progressão segura todos os exercícios enquanto isso. O mentor libera na
 * Visão Master; a academia não tinha onde, e o aluno do Free ficava suspenso
 * para sempre. O botão fica no aviso da dor da sugestão, que é onde o
 * professor lê a suspensão. Quem pode liberar o banco decide
 * (`liberar_progressao_aluno`: quem atende a saúde, no aluno do Free), e a
 * liberação fica nas observações do aluno.
 *
 * Fica fora de `SugestaoProgressao.tsx` de propósito: a sugestão só lê
 * (`sugestaoProgressao.guarda`), e liberar é outra decisão, sobre o relato.
 */
export function LiberarProgressao({ alunoId }: { alunoId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const liberar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("liberar_progressao_aluno", { _aluno_id: alunoId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Progressão liberada", description: "A liberação ficou registrada nas observações do aluno." });
      void queryClient.invalidateQueries({ queryKey: ["sugestao-progressao"] });
    },
    onError: (error: Error & { code?: string }) => {
      toast({
        title: "Não foi possível liberar",
        // A recusa nossa (42501) diz quem libera; o resto, não.
        description: error.code === "42501" ? error.message : "Tente de novo em instantes.",
        variant: "destructive",
      });
    },
  });

  return (
    <Button size="sm" variant="outline" disabled={liberar.isPending} onClick={() => liberar.mutate()}>
      {liberar.isPending ? "Liberando..." : "Já conversei: liberar a progressão"}
    </Button>
  );
}
