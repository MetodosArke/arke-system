import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { avisarEncerramento, dataCurta, executarEncerramentosAgora, retirarEncerramento } from "@/lib/encerramento";
import { hojeBrasilia } from "@/lib/dataBrasilia";

const ETAPA: Record<string, string> = {
  aviso: "Aviso em curso",
  encerrada: "Encerrada — janela de exportação",
  eliminada: "Dados eliminados",
  retirado: "Aviso retirado",
};

/**
 * Visão Master → ficha da organização → Encerramento. Avisar (pela academia,
 * quando ela pediu por telefone ou e-mail, ou pela ArkeFit), retirar o aviso
 * e rodar agora o que já venceu. Academia em trial sai pela exclusão simples.
 */
export function EncerramentoOrganizacao({ organizationId, status }: { organizationId: string; status: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [iniciativa, setIniciativa] = useState<"academia" | "arkefit">("academia");
  const [imediato, setImediato] = useState(false);

  const { data: historico = [] } = useQuery({
    queryKey: ["encerramentos-organizacao", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizacao_encerramentos")
        .select("id, etapa, iniciativa, motivo, solicitado_em, termino_em, eliminacao_em, cobrancas_canceladas, remocoes_agendadas, erro, tentativas, email_enviado_em")
        .eq("organization_id", organizationId)
        .order("solicitado_em", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });
  const emCurso = historico.find((h) => h.etapa === "aviso" || h.etapa === "encerrada");
  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["encerramentos-organizacao", organizationId] });
    void queryClient.invalidateQueries({ queryKey: ["superadmin-tenants"] });
  };

  const avisar = useMutation({
    mutationFn: () => avisarEncerramento(organizationId, motivo.trim(), iniciativa, iniciativa === "arkefit" && imediato),
    onSuccess: () => {
      setAberto(false);
      setMotivo("");
      atualizar();
      toast({ title: "Aviso registrado", description: "A gestão e a ArkeFit recebem o e-mail na próxima rodada." });
    },
    onError: (e: Error) => toast({ title: "Não foi possível avisar", description: e.message, variant: "destructive" }),
  });
  const retirar = useMutation({
    mutationFn: () => retirarEncerramento(organizationId),
    onSuccess: () => {
      atualizar();
      toast({ title: "Aviso retirado" });
    },
    onError: (e: Error) => toast({ title: "Não foi possível retirar", description: e.message, variant: "destructive" }),
  });
  const executar = useMutation({
    mutationFn: executarEncerramentosAgora,
    onSuccess: (r) => {
      atualizar();
      toast({
        title: "Rodada executada",
        description: `${r.terminos} término(s), ${r.eliminacoes} eliminação(ões)${r.pendentes ? `, ${r.pendentes} continua(m) na próxima rodada` : ""}${r.falhas ? `, ${r.falhas} com falha` : ""}.`,
      });
    },
    onError: (e: Error) => toast({ title: "Não foi possível executar", description: e.message, variant: "destructive" }),
  });

  if (status === "trial") {
    return <p className="text-sm text-muted-foreground">Academia em homologação: sai pela exclusão, sem ciclo de encerramento.</p>;
  }

  const hoje = hojeBrasilia();
  const vencido =
    emCurso && ((emCurso.etapa === "aviso" && emCurso.termino_em <= hoje) || (emCurso.etapa === "encerrada" && emCurso.eliminacao_em <= hoje));

  return (
    <div className="space-y-3 text-sm">
      {emCurso ? (
        <div className="space-y-1 rounded-md border p-3">
          <p className="font-medium">{ETAPA[emCurso.etapa]}</p>
          <p className="text-xs text-muted-foreground">
            {emCurso.iniciativa === "academia" ? "A pedido da academia" : "Por decisão da ArkeFit"} · término {dataCurta(emCurso.termino_em)} ·
            eliminação {dataCurta(emCurso.eliminacao_em)}
          </p>
          <p className="text-xs">Motivo: {emCurso.motivo}</p>
          {emCurso.etapa === "encerrada" && (
            <p className="text-xs text-muted-foreground">
              {emCurso.cobrancas_canceladas ?? 0} cobrança(s) cancelada(s) · {emCurso.remocoes_agendadas ?? 0} remoção(ões) de digital agendada(s)
            </p>
          )}
          {!emCurso.email_enviado_em && emCurso.etapa === "aviso" && <p className="text-xs text-muted-foreground">E-mail do aviso sai na próxima rodada.</p>}
          {emCurso.erro && (
            <p className="text-xs text-destructive">
              Última falha ({emCurso.tentativas} tentativa{emCurso.tentativas === 1 ? "" : "s"}): {emCurso.erro}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {emCurso.etapa === "aviso" && (
              <Button size="sm" variant="outline" disabled={retirar.isPending} onClick={() => retirar.mutate()}>
                Retirar aviso
              </Button>
            )}
            {vencido && (
              <Button size="sm" disabled={executar.isPending} onClick={() => executar.mutate()}>
                {executar.isPending ? "Executando…" : emCurso.etapa === "aviso" ? "Executar o término agora" : "Eliminar os dados agora"}
              </Button>
            )}
          </div>
        </div>
      ) : aberto ? (
        <div className="space-y-2">
          <RadioGroup value={iniciativa} onValueChange={(v) => setIniciativa(v as "academia" | "arkefit")} className="flex gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="academia" id="enc-academia" />
              <Label htmlFor="enc-academia">A academia pediu</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="arkefit" id="enc-arkefit" />
              <Label htmlFor="enc-arkefit">Decisão da ArkeFit</Label>
            </div>
          </RadioGroup>
          <Label htmlFor="enc-motivo">Motivo</Label>
          <Textarea id="enc-motivo" rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          {iniciativa === "arkefit" && (
            <div className="flex items-center gap-2">
              <Switch id="enc-imediato" checked={imediato} onCheckedChange={setImediato} />
              <Label htmlFor="enc-imediato">Sem aviso de 30 dias (violação grave dos Termos)</Label>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={avisar.isPending || motivo.trim().length < 3} onClick={() => avisar.mutate()}>
              Registrar aviso
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAberto(false)}>
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
          Avisar encerramento…
        </Button>
      )}

      {historico.filter((h) => h !== emCurso).length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {historico
            .filter((h) => h !== emCurso)
            .map((h) => (
              <li key={h.id}>
                {ETAPA[h.etapa]} · avisado em {dataCurta(h.solicitado_em)} · término {dataCurta(h.termino_em)}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
