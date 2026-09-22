import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

const PERIODO: Record<string, string> = { mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual" };

/**
 * Planos da academia, com os modelos (mensal, trimestral, anual) que nascem
 * inativos: a academia confere o preço e liga. Ativos de fábrica, eles
 * completariam a etapa com um valor que ninguém conferiu.
 */
export function EtapaPlanos({ onSalvo }: { onSalvo: () => void }) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});

  const { data: planos = [] } = useQuery({
    queryKey: ["onboarding-planos", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos_academia")
        .select("id, nome, periodicidade, valor, ativo")
        .eq("organization_id", organization!.id)
        .order("valor");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    setValores(Object.fromEntries(planos.map((p) => [p.id, Number(p.valor).toFixed(2).replace(".", ",")])));
  }, [planos]);

  const salvar = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const valor = Number((valores[id] ?? "").replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe um valor maior que zero.");
      const { error } = await supabase.from("planos_academia").update({ valor, ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["onboarding-planos", organization?.id] });
      onSalvo();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar o plano", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Confira o valor e ligue os planos que a academia vende. Outros planos: Organização → Planos da Academia.</p>
      {planos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum plano ainda. Crie em Organização → Planos da Academia.</p>}
      <ul className="divide-y rounded-md border">
        {planos.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{p.nome}</p>
              <p className="text-[11px] text-muted-foreground">{PERIODO[p.periodicidade] ?? p.periodicidade}</p>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">R$</span>
              <Input
                aria-label={`Valor do plano ${p.nome}`}
                className="h-8 w-24"
                inputMode="decimal"
                value={valores[p.id] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [p.id]: e.target.value }))}
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              disabled={salvar.isPending}
              onClick={() => salvar.mutate({ id: p.id, ativo: p.ativo })}
            >
              Salvar
            </Button>
            <Switch
              aria-label={`${p.ativo ? "Desativar" : "Ativar"} ${p.nome}`}
              checked={p.ativo}
              disabled={salvar.isPending}
              onCheckedChange={(ativo) => salvar.mutate({ id: p.id, ativo })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
