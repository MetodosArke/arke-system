import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

const INCLUI = ["Acolhimento M.A.P.A.®", "Fases da jornada", "Chat com a nutricionista", "Mentor ARKE"];
const NIVEL: Record<string, string> = { integrado: "Integrado", elite: "Elite" };

const reais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * O que o Método ARKE soma ao plano Free — à venda desde o primeiro dia
 * (decisão do responsável, 23/09/2026).
 *
 * Só aparece quando a academia de fato vende o Método: nível disponível, preço
 * de varejo e repasse negociado com a ArkeFit (public.metodo_ofertas_academia(),
 * as mesmas condições que a cobrança confere). Anunciar a quem não pode
 * comprar mandaria o aluno à recepção atrás de algo que não existe.
 *
 * A contratação é feita pela academia, no painel — o app não vende sozinho:
 * a matrícula no Método gera cobrança recorrente, e quem combina forma de
 * pagamento com o aluno é a recepção.
 *
 * `recurso` é usado onde o aluno esbarra num item do Método (o chat com a
 * nutricionista): diz o que falta sem trancar a tela nem cobrar nada.
 */
export function MetodoArke({ organizationId, recurso }: { organizationId: string; recurso?: string }) {
  const { data: ofertas = [], isLoading } = useQuery({
    queryKey: ["metodo-ofertas", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("metodo_ofertas_academia", { _organization_id: organizationId });
      if (error) throw error;
      return (data ?? []) as { nivel: string; valor_varejo: number }[];
    },
    staleTime: 10 * 60_000,
  });

  if (isLoading) return null;

  if (recurso) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        {ofertas.length > 0 ? (
          <>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Faz parte do Método ARKE
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              {recurso} está no Método ARKE, disponível na sua academia a partir de{" "}
              {reais(Number(ofertas[0].valor_varejo))}/mês. Fale com a recepção para assinar.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground max-w-xs">{recurso} não está disponível no seu plano.</p>
        )}
      </div>
    );
  }

  if (ofertas.length === 0) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="py-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" /> Método ARKE na sua academia
        </p>
        <p className="text-xs text-muted-foreground">
          Um acompanhamento completo de treino, nutrição e rotina, com um mentor da ArkeFit, pensado para você chegar
          mais longe.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {INCLUI.map((item) => (
            <li key={item} className="text-[11px] rounded-full border border-primary/30 px-2 py-0.5 text-primary">
              {item}
            </li>
          ))}
        </ul>
        <p className="text-xs">
          {ofertas.map((o) => `${NIVEL[o.nivel] ?? o.nivel} ${reais(Number(o.valor_varejo))}/mês`).join(" · ")} —{" "}
          <strong>fale com a recepção para assinar.</strong>
        </p>
      </CardContent>
    </Card>
  );
}
