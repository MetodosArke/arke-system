import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { ETAPAS, type EtapaOnboarding } from "@/lib/onboardingAcademia";
import { useOnboardingAcademia } from "@/hooks/useOnboardingAcademia";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, ChevronDown, Circle, Clock, PartyPopper, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { EtapaDados } from "@/components/admin/onboarding/EtapaDados";
import { EtapaRecebimentos } from "@/components/admin/onboarding/EtapaRecebimentos";
import { EtapaPlanos } from "@/components/admin/onboarding/EtapaPlanos";
import { EtapaEquipe } from "@/components/admin/onboarding/EtapaEquipe";
import { EtapaAlunos } from "@/components/admin/onboarding/EtapaAlunos";
import { SuporteBotao } from "@/components/admin/onboarding/SuporteBotao";

/**
 * Onboarding da academia em etapas (Rodada 4). Cada etapa pode ser feita em
 * qualquer ordem e retomada depois; o que está pronto é lido do banco. O painel
 * funciona desde o primeiro dia (decisão D5), mas alunos no app e cobranças só
 * começam quando o gestor conclui — e aí nasce a mensalidade B2B no Asaas.
 */
export default function AdminOnboarding() {
  const { organization, organizationRole, hasRole, refreshOrganization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { status, percentual, proxima, minutos, tudoPronto, isLoading } = useOnboardingAcademia();
  const [aberta, setAberta] = useState<EtapaOnboarding | null>(null);
  const podeEditar = organizationRole === "gestor" || hasRole("admin_arke") || hasRole("superadmin");
  const concluido = !!organization?.onboardingCompleted;

  // Abre na primeira etapa pendente.
  useEffect(() => {
    if (aberta === null && proxima) setAberta(proxima);
  }, [proxima, aberta]);

  const recarregar = () => void queryClient.invalidateQueries({ queryKey: ["onboarding-academia", organization?.id] });

  const concluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("concluir_onboarding_organizacao", { _organization_id: organization!.id });
      if (error) throw error;
      // A mensalidade B2B nasce aqui. Falha nela não desfaz a conclusão: os
      // alunos já podem entrar, e a ArkeFit cria a assinatura pela Visão Master.
      const { error: erroB2b } = await supabase.functions.invoke("asaas-assinatura-b2b", {
        body: { organization_id: organization!.id },
      });
      return erroB2b ? await mensagemDeErroEdge(erroB2b, "A mensalidade será iniciada pela ArkeFit.") : null;
    },
    onSuccess: async (avisoB2b) => {
      toast({
        title: "Tudo pronto! Alunos liberados no app.",
        description: avisoB2b ? `Sobre a mensalidade do ARKE: ${avisoB2b}` : "A mensalidade do ARKE começa hoje; a fatura chega no e-mail da academia.",
      });
      await refreshOrganization();
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Ainda falta alguma etapa", description: e.message, variant: "destructive" }),
  });

  const conteudo = (etapa: EtapaOnboarding) => {
    switch (etapa) {
      case "dados":
        return <EtapaDados onSalvo={recarregar} />;
      case "recebimentos":
        return <EtapaRecebimentos onSalvo={recarregar} />;
      case "planos":
        return <EtapaPlanos onSalvo={recarregar} />;
      case "equipe":
        return <EtapaEquipe onSalvo={recarregar} />;
      case "alunos":
        return <EtapaAlunos />;
    }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto pb-16">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Configuração da academia</h1>
      </div>

      {concluido ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="py-4 flex items-start gap-3">
            <PartyPopper className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Configuração concluída — os alunos já usam o app.</p>
              <p className="text-muted-foreground text-xs">Você pode voltar a qualquer etapa para ajustar.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{percentual}% concluído</span>
              {minutos > 0 && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> cerca de {minutos} min para terminar
                </span>
              )}
            </div>
            <Progress value={percentual} />
            <p className="text-xs text-muted-foreground">
              O painel já funciona. Os alunos entram no app e as cobranças começam quando todas as etapas estiverem prontas.
            </p>
          </CardContent>
        </Card>
      )}

      {!podeEditar && <p className="text-sm text-muted-foreground">Só o gestor da academia altera a configuração.</p>}

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      <ol className="space-y-2">
        {ETAPAS.map((e, i) => {
          const s = status.find((x) => x.etapa === e.etapa);
          const feita = !!s?.concluida;
          const expandida = aberta === e.etapa;
          return (
            <li key={e.etapa}>
              <Card className={cn(expandida && "border-primary/50")}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  aria-expanded={expandida}
                  onClick={() => setAberta(expandida ? null : e.etapa)}
                >
                  {feita ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" aria-label="Concluída" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground shrink-0" aria-label="Pendente" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium block">
                      {i + 1}. {e.titulo}
                      {!feita && proxima === e.etapa && <span className="ml-2 text-[11px] text-primary font-normal">próximo passo</span>}
                    </span>
                    <span className="text-xs text-muted-foreground block truncate">{s?.detalhe ?? e.resumo}</span>
                  </span>
                  {!feita && <span className="text-[11px] text-muted-foreground shrink-0">~{e.minutos} min</span>}
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expandida && "rotate-180")} />
                </button>
                {expandida && podeEditar && (
                  <CardContent className="pt-0 space-y-3">
                    {conteudo(e.etapa)}
                    <SuporteBotao contexto={`${organization?.nome ?? "academia"} — ${e.titulo}`} />
                  </CardContent>
                )}
              </Card>
            </li>
          );
        })}
      </ol>

      {!concluido && podeEditar && (
        <Button className="w-full" size="lg" disabled={!tudoPronto || concluir.isPending} onClick={() => concluir.mutate()}>
          {concluir.isPending ? "Liberando..." : tudoPronto ? "Concluir e liberar o app para os alunos" : "Conclua as etapas para liberar"}
        </Button>
      )}
    </div>
  );
}
