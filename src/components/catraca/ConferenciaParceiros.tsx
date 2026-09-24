import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { inicioDoMesBrasilia } from "@/lib/dataBrasilia";

const PARCEIRO: Record<string, string> = { wellhub: "Wellhub (Gympass)", totalpass: "TotalPass" };

/** "2026-09-01" → o primeiro dia do mês deslocado em `n` meses, no mesmo formato. */
function deslocarMes(inicio: string, n: number): string {
  const [ano, mes] = inicio.split("-").map(Number);
  const total = ano * 12 + (mes - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * Conferência mensal dos check-ins de parceiro.
 *
 * O Wellhub e o TotalPass pagam à academia por visita, e a academia confere o
 * repasse contra o que ela registrou. Até aqui o registro existia (cada
 * check-in confirmado na recepção) mas só dava para ver os 20 últimos
 * acessos, misturados com os dos alunos. O mês é o de Brasília, que é o da
 * academia e o do extrato do parceiro.
 */
export function ConferenciaParceiros({ organizationId }: { organizationId: string }) {
  const atual = inicioDoMesBrasilia();
  const [inicio, setInicio] = useState(atual);
  const fim = deslocarMes(inicio, 1);

  const { data: checkins = [], isLoading } = useQuery({
    queryKey: ["conferencia-parceiros", organizationId, inicio],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acessos_catraca_logs")
        .select("id, parceiro_externo, nome_visitante_externo, created_at")
        .eq("organization_id", organizationId)
        .eq("resultado", "liberado_parceiro_externo")
        .gte("created_at", `${inicio}T00:00:00-03:00`)
        .lt("created_at", `${fim}T00:00:00-03:00`)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const porParceiro = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of checkins) m.set(c.parceiro_externo ?? "?", (m.get(c.parceiro_externo ?? "?") ?? 0) + 1);
    return [...m.entries()];
  }, [checkins]);

  const rotuloMes = new Date(`${inicio}T12:00:00-03:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Mês anterior" onClick={() => setInicio(deslocarMes(inicio, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-36 text-center font-medium capitalize">{rotuloMes}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Próximo mês"
          disabled={inicio >= atual}
          onClick={() => setInicio(deslocarMes(inicio, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {isLoading ? null : porParceiro.length === 0 ? (
        <p className="text-muted-foreground">Nenhum check-in de parceiro neste mês.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            {porParceiro.map(([p, n]) => (
              <div key={p}>
                <p className="text-2xl font-bold">{n}</p>
                <p className="text-xs text-muted-foreground">{PARCEIRO[p] ?? p}</p>
              </div>
            ))}
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Ver um a um</summary>
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-auto">
              {checkins.map((c) => (
                <li key={c.id}>
                  {new Date(c.created_at).toLocaleString("pt-BR")} · {PARCEIRO[c.parceiro_externo ?? ""] ?? c.parceiro_externo}
                  {c.nome_visitante_externo ? ` · ${c.nome_visitante_externo}` : ""}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
