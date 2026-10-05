import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exigirGravacao } from "@/lib/gravacao";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useVersaoMinimaGateway } from "@/lib/gateway";

/**
 * A versão mínima do Gateway Local. Abaixo dela, Equipamentos marca a catraca
 * e o próprio Gateway avisa no log; nada é bloqueado.
 */
export function VersaoMinimaGateway() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: atual, isLoading } = useVersaoMinimaGateway();
  const [valor, setValor] = useState("");

  useEffect(() => {
    if (!isLoading) setValor(atual ?? "");
  }, [atual, isLoading]);

  const salvar = useMutation({
    mutationFn: async (texto: string) => {
      const versao = texto.trim();
      if (versao && !/^\d+\.\d+\.\d+$/.test(versao)) throw new Error("Use o formato 1.7.0.");
      // Sem a linha devolvida, a regra de acesso recusou em silêncio.
      await exigirGravacao(
        supabase
          .from("plataforma_textos")
          .update({ valor: versao || null, updated_at: new Date().toISOString() })
          .eq("chave", "gateway_versao_minima")
          .select("chave"),
        "Nada foi gravado. Confira se a sessão está verificada em duas etapas."
      );
    },
    onSuccess: () => {
      toast({ title: "Versão mínima salva" });
      void queryClient.invalidateQueries({ queryKey: ["gateway-versao-minima"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Versão mínima do Gateway</CardTitle>
        <CardDescription>
          Abaixo dela, Equipamentos marca a catraca e o próprio Gateway avisa no log. Nada é bloqueado. Vazio: sem
          mínima.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="gateway-versao-minima" className="text-xs">
            Versão
          </Label>
          <Input
            id="gateway-versao-minima"
            className="w-32"
            placeholder="1.7.0"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => salvar.mutate(valor)} disabled={salvar.isPending || isLoading}>
          {salvar.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </CardContent>
    </Card>
  );
}
