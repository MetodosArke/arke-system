import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ExportarDadosAcademia } from "@/components/admin/ExportarDadosAcademia";
import { avisarEncerramento, dataCurta, encerramentoDaAcademia, retirarEncerramento } from "@/lib/encerramento";

/**
 * Organização → Dados e encerramento (só a gestão). Exportar todos os dados
 * vale a qualquer momento; o encerramento segue o contrato: aviso com 30 dias,
 * que a academia pode retirar enquanto o término não chega.
 */
export function EncerramentoAcademia() {
  const { organization, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pedindo, setPedindo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const orgId = organization?.id;

  const { data: encerramento } = useQuery({
    queryKey: ["encerramento-academia", orgId],
    queryFn: () => encerramentoDaAcademia(orgId!),
    enabled: !!orgId,
  });
  const atualizar = () => void queryClient.invalidateQueries({ queryKey: ["encerramento-academia", orgId] });

  const avisar = useMutation({
    mutationFn: (texto: string) => avisarEncerramento(orgId!, texto, "academia"),
    onSuccess: () => {
      setPedindo(false);
      setMotivo("");
      atualizar();
      toast({ title: "Aviso de encerramento registrado", description: "Você e a ArkeFit recebem um e-mail com as datas." });
    },
    onError: (e: Error) => toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });
  const retirar = useMutation({
    mutationFn: () => retirarEncerramento(orgId!),
    onSuccess: () => {
      atualizar();
      toast({ title: "Aviso retirado", description: "O contrato segue normalmente." });
    },
    onError: (e: Error) => toast({ title: "Não foi possível retirar", description: e.message, variant: "destructive" }),
  });

  if (organizationRole !== "gestor" || !organization || organization.status === "trial") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dados e encerramento</CardTitle>
        <CardDescription>
          A planilha traz alunos com contato e endereço, matrículas, mensalidades, cobranças avulsas, presenças e avaliações físicas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ExportarDadosAcademia />

        {encerramento?.etapa === "aviso" ? (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>
              O contrato termina em <strong>{dataCurta(encerramento.termino_em)}</strong>
              {encerramento.iniciativa === "arkefit" ? ", por decisão da ArkeFit" : ", a pedido da academia"}. Depois disso, você terá até{" "}
              {dataCurta(encerramento.eliminacao_em)} para exportar os dados.
            </p>
            {encerramento.iniciativa === "academia" && (
              <Button size="sm" variant="outline" disabled={retirar.isPending} onClick={() => retirar.mutate()}>
                Retirar o aviso e continuar
              </Button>
            )}
          </div>
        ) : pedindo ? (
          <div className="space-y-2">
            <Label htmlFor="motivo-encerramento">Por que a academia vai encerrar?</Label>
            <Textarea id="motivo-encerramento" rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              O contrato termina 30 dias depois deste aviso. Até lá tudo segue funcionando; no término as cobranças dos alunos pelo ARKE
              param e as digitais saem das catracas. Você pode retirar o aviso antes disso.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" disabled={avisar.isPending || motivo.trim().length < 3} onClick={() => avisar.mutate(motivo.trim())}>
                Avisar encerramento
              </Button>
              <Button variant="ghost" onClick={() => setPedindo(false)}>
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="text-muted-foreground" onClick={() => setPedindo(true)}>
            Encerrar o contrato…
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
