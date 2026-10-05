import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDuasEtapasNaAcao } from "@/components/duasEtapas/useDuasEtapasNaAcao";

/**
 * Perfil da gestão → Verificação em duas etapas (decisão de 04/10/2026). É
 * opcional: ligada, a entrada no painel pede o código do aplicativo
 * autenticador além da senha. Exportar todos os dados, encerrar a academia e
 * trocar o e-mail de login de alguém pedem o código de qualquer jeito.
 */
export function DuasEtapasGestor() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { exigir, dialogo } = useDuasEtapasNaAcao(
    "Leia o QR code com o aplicativo autenticador do celular e digite o código. Depois disso, a entrada no painel pede o código além da senha."
  );

  const { data: fator, isLoading } = useQuery({
    queryKey: ["duas-etapas-fator"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp.find((f) => f.status === "verified") ?? null;
    },
  });
  const atualizar = () => void queryClient.invalidateQueries({ queryKey: ["duas-etapas-fator"] });

  const ativar = () =>
    void exigir(() => {
      atualizar();
      toast({ title: "Verificação em duas etapas ativada", description: "A próxima entrada no painel pede o código do aplicativo." });
    });

  const desativar = () =>
    void exigir(async () => {
      if (!fator) return;
      const { error } = await supabase.auth.mfa.unenroll({ factorId: fator.id });
      if (error) {
        toast({ title: "Não foi possível desativar", description: error.message, variant: "destructive" });
        return;
      }
      atualizar();
      toast({ title: "Verificação em duas etapas desativada" });
    });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> Verificação em duas etapas
          {fator && <Badge variant="secondary">Ativada</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {fator
            ? "A entrada no painel pede, além da senha, o código do aplicativo autenticador do seu celular."
            : "Opcional. Ligada, a entrada no painel pede, além da senha, um código do aplicativo autenticador do celular. Quem tiver a sua senha não entra sem o seu celular."}
        </p>
        <p className="text-xs text-muted-foreground">
          Exportar todos os dados, encerrar a academia e trocar o e-mail de login de alguém da equipe pedem o código mesmo com ela
          desligada. Se perder o celular, fale com a ArkeFit.
        </p>
        {!isLoading &&
          (fator ? (
            <Button variant="outline" size="sm" onClick={desativar}>
              Desativar
            </Button>
          ) : (
            <Button size="sm" onClick={ativar}>
              Ativar
            </Button>
          ))}
        {dialogo}
      </CardContent>
    </Card>
  );
}
