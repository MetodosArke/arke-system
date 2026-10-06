import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exigirGravacao } from "@/lib/gravacao";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/**
 * O interruptor da subconta aberta pela ArkeFit (`asaas_subcontas_baas`).
 *
 * Abrir a conta da academia pela conta da ArkeFit é BaaS para o Asaas, com
 * homologação. Desligado, a abertura pela ArkeFit some da tela (menos na
 * organização em trial, que fala com o sandbox) e a função recusa a abertura;
 * a subconta que já existe continua funcionando. Ligar só depois da
 * homologação do BaaS com o Asaas.
 */
export function SubcontasBaas() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ligado, isLoading } = useQuery({
    queryKey: ["plataforma-config-subcontas-baas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plataforma_config").select("valor").eq("chave", "asaas_subcontas_baas").maybeSingle();
      if (error) throw error;
      return Number(data?.valor ?? 0) === 1;
    },
  });

  const salvar = useMutation({
    mutationFn: async (valor: boolean) => {
      await exigirGravacao(
        supabase
          .from("plataforma_config")
          .update({ valor: valor ? 1 : 0, updated_by: user?.id })
          .eq("chave", "asaas_subcontas_baas")
          .select("id"),
      );
    },
    onSuccess: (_r, valor) => {
      toast({ title: valor ? "Subconta pela ArkeFit ligada" : "Subconta pela ArkeFit desligada" });
      void queryClient.invalidateQueries({ queryKey: ["plataforma-config-subcontas-baas"] });
      void queryClient.invalidateQueries({ queryKey: ["asaas-subcontas-baas"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Conta Asaas aberta pela ArkeFit (BaaS)</CardTitle>
        <CardDescription>
          Ligado, a etapa Recebimentos oferece abrir a conta da academia pela ArkeFit, com o aceite dos Termos de Uso do Asaas e o envio dos
          documentos pelo link do Asaas. Desligado, a academia abre a própria conta e informa a carteira; a organização em trial
          (sandbox) continua vendo o caminho, para a homologação. As subcontas já abertas seguem funcionando. Ligue só depois da
          homologação do BaaS com o Asaas.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Switch
          id="subcontas-baas"
          checked={!!ligado}
          disabled={isLoading || salvar.isPending}
          onCheckedChange={(v) => salvar.mutate(v)}
        />
        <Label htmlFor="subcontas-baas" className="text-sm">
          {ligado ? "Ligado" : "Desligado"}
        </Label>
      </CardContent>
    </Card>
  );
}
