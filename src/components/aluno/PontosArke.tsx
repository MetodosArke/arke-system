import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hojeBrasilia, inicioDoMesBrasilia } from "@/lib/dataBrasilia";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { Card, CardContent } from "@/components/ui/card";

/**
 * A Pontuação ARKE do aluno no mês (gamificação, decidido em 10/11/2026): a
 * constância contra a meta dele, os check-ins e os desafios cumpridos. A conta
 * mora no banco (`pontos_arke`). Só soma: dor, pedido de ajuda e falta
 * justificada não tiram ponto.
 */
export function PontosArke({ alunoId }: { alunoId: string }) {
  const inicio = inicioDoMesBrasilia();
  const hoje = hojeBrasilia();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["aluno-pontos-arke", alunoId, inicio, hoje],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pontos_arke", { _aluno_id: alunoId, _de: inicio, _ate: hoje });
      if (error) throw error;
      return data?.[0] ?? { constancia: 0, checkins: 0, desafios: 0, total: 0 };
    },
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Seus pontos ARKE no mês
          </p>
          {data && <p className="text-xl font-bold text-primary">{data.total}</p>}
        </div>
        {isLoading && <p className="text-xs text-muted-foreground" role="status">Carregando…</p>}
        {error && <ErroAoCarregar oQue="os seus pontos" onTentarDeNovo={() => void refetch()} tentando={isFetching} className="p-2" />}
        {data && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-sm font-semibold">{data.constancia}</p>
                <p className="text-[10px] text-muted-foreground">Constância</p>
              </div>
              <div>
                <p className="text-sm font-semibold">{data.checkins}</p>
                <p className="text-[10px] text-muted-foreground">Check-ins</p>
              </div>
              <div>
                <p className="text-sm font-semibold">{data.desafios}</p>
                <p className="text-[10px] text-muted-foreground">Desafios</p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Cada semana vale até 20 pontos, contra a sua própria meta de treinos; cada check-in, 2; e cada desafio, os pontos
              dele. Contar que sentiu dor ou que está com dificuldade nunca tira ponto.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
