import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { erroDataNascimento } from "@/lib/menorDeIdade";
import { emPerfilSimulado } from "@/lib/impersonation";
import { AvisoPerfilSimulado } from "@/components/AvisoPerfilSimulado";
import { chaveMenorDeIdade } from "@/components/responsavel/useMenorDeIdade";

/**
 * O aluno sem data de nascimento (todos os de antes de 06/10/2026) a informa
 * uma vez, antes do primeiro consentimento sensível. Pela RPC
 * `informar_data_nascimento`, que só grava onde a data falta e recusa a sessão
 * simulada: a data decide quem precisa do aceite do responsável.
 */
export function InformarNascimento({ alunoId }: { alunoId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const simulado = emPerfilSimulado();
  const hoje = hojeBrasilia();
  const [data, setData] = useState("");

  const informar = useMutation({
    mutationFn: async (valor: string) => {
      const erro = erroDataNascimento(valor, hojeBrasilia());
      if (erro) throw new Error(erro);
      const { data: gravadas, error } = await supabase.rpc("informar_data_nascimento", { _data: valor });
      if (error) throw new Error(error.message);
      if (!gravadas) throw new Error("A data já estava no cadastro. Se estiver errada, peça à recepção para corrigir.");
    },
    onSuccess: () => {
      toast({ title: "Data de nascimento registrada" });
      void queryClient.invalidateQueries({ queryKey: chaveMenorDeIdade(alunoId) });
    },
    onError: (e: Error) => toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        informar.mutate(data);
      }}
    >
      <p className="text-xs text-muted-foreground">
        Antes de autorizar, informe a sua data de nascimento. Ela é pedida uma vez: para quem tem menos de 18 anos, a
        lei pede antes a autorização do responsável legal.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`nascimento-${alunoId}`} className="text-xs">
            Data de nascimento
          </Label>
          <Input
            id={`nascimento-${alunoId}`}
            type="date"
            min="1900-01-01"
            max={hoje}
            required
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="w-44"
          />
        </div>
        <Button type="submit" size="sm" disabled={!data || informar.isPending || simulado}>
          {informar.isPending ? "Salvando..." : "Confirmar"}
        </Button>
      </div>
      {simulado && <AvisoPerfilSimulado />}
    </form>
  );
}
