import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { exigirGravacao } from "@/lib/gravacao";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarX, LogOut } from "lucide-react";
import { ExportarDadosAcademia } from "@/components/admin/ExportarDadosAcademia";
import { ExportarContador } from "@/components/admin/ExportarContador";
import { DESFECHO_REMOCAO, dataCurta, encerramentoDaAcademia, remocoesPendentes } from "@/lib/encerramento";

/**
 * Encerramento do contrato da academia, do lado de quem usa o sistema.
 *
 * - Durante o aviso, tudo funciona; a gestão vê uma faixa com a data do
 *   término e onde exportar os dados, e o aluno vê a data e o que acontece
 *   com os dados dele (o detalhe vai por e-mail).
 * - Depois do término, o painel fica só para exportação e para fechar a
 *   remoção das digitais (a gestão), e o app avisa o aluno até quando os
 *   dados dele ficam. É o que o contrato descreve: as cobranças já pararam e
 *   as digitais saem das catracas.
 *
 * Gate de experiência, como os outros: quem protege os dados é o RLS.
 */
export function EncerramentoGate({ children, publico }: { children: ReactNode; publico: "equipe" | "aluno" }) {
  const { organization, organizationRole, signOut } = useAuth();
  const orgId = organization?.id;
  const { data: encerramento } = useQuery({
    queryKey: ["encerramento-academia", orgId],
    queryFn: () => encerramentoDaAcademia(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });

  if (!encerramento) return <>{children}</>;
  const gestao = publico === "equipe" && organizationRole === "gestor";
  const academia = organization?.nome ?? "A academia";

  if (encerramento.etapa === "aviso") {
    if (publico === "aluno") {
      return (
        <>
          <div role="status" className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-warning">
            {academia} vai encerrar o uso do ARKE em <strong>{dataCurta(encerramento.termino_em)}</strong>. Até lá tudo segue funcionando.
            Seus dados desta academia ficam até {dataCurta(encerramento.eliminacao_em)} e depois são eliminados; mandamos os detalhes
            por e-mail.
          </div>
          {children}
        </>
      );
    }
    if (!gestao) return <>{children}</>;
    return (
      <>
        <div role="status" className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-warning">
          O contrato com o ARKE termina em <strong>{dataCurta(encerramento.termino_em)}</strong>. Até lá tudo segue funcionando;
          exporte os dados em{" "}
          <Link to="/admin/organizacao" className="underline">
            Organização
          </Link>
          .
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarX className="h-5 w-5 text-muted-foreground" />
            {publico === "aluno" ? "Sua academia encerrou o uso do ARKE" : "Contrato encerrado"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {publico === "aluno" ? (
            <>
              <p>
                {academia} encerrou o uso do ARKE em {dataCurta(encerramento.termino_em)}. Seus treinos e pagamentos passam a ser tratados
                diretamente com a recepção.
              </p>
              <p>
                Seus dados desta academia ficam guardados até <strong>{dataCurta(encerramento.eliminacao_em)}</strong> e depois são
                eliminados, salvo o que a lei manda guardar. Para pedir uma cópia, fale com a academia; sobre o Método ARKE, com a ArkeFit
                (o contato está na{" "}
                <Link to="/privacidade" className="underline">
                  Política de Privacidade
                </Link>
                ).
              </p>
            </>
          ) : gestao ? (
            <>
              <p>
                O contrato com o ARKE terminou em {dataCurta(encerramento.termino_em)}. As cobranças dos alunos pararam e as digitais
                saíram das catracas com gestão remota.
              </p>
              <p>
                Até <strong>{dataCurta(encerramento.eliminacao_em)}</strong> você pode exportar os dados da academia. Depois disso eles
                são eliminados, como prevê o contrato.
              </p>
              <div className="flex flex-wrap gap-2">
                <ExportarDadosAcademia variante="default" />
                <ExportarContador />
              </div>
              {orgId && <RemocaoNasCatracas organizationId={orgId} />}
            </>
          ) : (
            <p>
              O contrato da academia com o ARKE terminou em {dataCurta(encerramento.termino_em)}. Fale com a gestão da academia.
            </p>
          )}
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A remoção à mão que o término deixou para a academia: catraca sem gestão
 * remota, ou ordem que o Gateway não confirmou. Com o painel travado, era
 * aqui ou em lugar nenhum — e a eliminação apagaria a tarefa aberta. Cada uma
 * fecha com desfecho, e o registro do encerramento guarda a contagem.
 */
function RemocaoNasCatracas({ organizationId }: { organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: tarefas = [] } = useQuery({
    queryKey: ["encerramento-remocoes-pendentes", organizationId],
    queryFn: () => remocoesPendentes(organizationId),
  });
  const fechar = useMutation({
    mutationFn: async ({ id, desfecho }: { id: string; desfecho: string }) => {
      await exigirGravacao(supabase.from("tarefas").update({ status: "concluida", desfecho_acao: desfecho }).eq("id", id).select("id"));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["encerramento-remocoes-pendentes", organizationId] }),
    onError: (e: Error) => toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });

  if (!tarefas.length) return null;
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 p-3">
      <p className="font-medium">Falta apagar das catracas</p>
      <p className="text-xs text-muted-foreground">
        Estes usuários estão em catracas que o ARKE não apaga sozinho. Em cada equipamento, exclua o usuário com as digitais, o rosto e os
        cartões, e registre aqui. A LGPD exige a remoção, e o registro fica como prova depois da eliminação.
      </p>
      <ul className="space-y-2">
        {tarefas.map((t) => (
          <li key={t.id} className="space-y-1 border-t pt-2 first:border-0 first:pt-0">
            <p className="text-xs">{t.motivo}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={fechar.isPending} onClick={() => fechar.mutate({ id: t.id, desfecho: DESFECHO_REMOCAO.apagado })}>
                Apaguei do equipamento
              </Button>
              <Button size="sm" variant="ghost" disabled={fechar.isPending} onClick={() => fechar.mutate({ id: t.id, desfecho: DESFECHO_REMOCAO.ausente })}>
                Não estava no equipamento
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
