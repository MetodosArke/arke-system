import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Megaphone } from "lucide-react";
import { hojeBrasilia } from "@/lib/dataBrasilia";

/** Avisos da academia ainda não lidos pelo aluno. Some quando não há nenhum. */
export function ComunicadosAluno() {
  const { user, organization } = useAuth();
  const queryClient = useQueryClient();

  const { data: avisos = [] } = useQuery({
    queryKey: ["comunicados-aluno", organization?.id, user?.id],
    queryFn: async () => {
      const hoje = hojeBrasilia();
      const [{ data: lista, error }, { data: lidos }] = await Promise.all([
        supabase
          .from("comunicados")
          .select("id, titulo, mensagem, criado_em, expira_em")
          .eq("organization_id", organization!.id)
          .in("publico", ["alunos", "todos"])
          .or(`expira_em.is.null,expira_em.gte.${hoje}`)
          .order("criado_em", { ascending: false })
          .limit(10),
        supabase.from("comunicados_lidos").select("comunicado_id").eq("user_id", user!.id),
      ]);
      if (error) throw error;
      const jaLidos = new Set((lidos ?? []).map((l) => l.comunicado_id));
      return (lista ?? []).filter((c) => !jaLidos.has(c.id));
    },
    enabled: !!organization?.id && !!user?.id,
  });

  if (!avisos.length) return null;

  const marcarLido = async (id: string) => {
    await supabase.from("comunicados_lidos").insert({ comunicado_id: id, user_id: user!.id, organization_id: organization!.id });
    void queryClient.invalidateQueries({ queryKey: ["comunicados-aluno", organization?.id, user?.id] });
  };

  return (
    <div className="space-y-2">
      {avisos.map((a) => (
        <Card key={a.id} className="border-primary/30">
          <CardContent className="py-3 space-y-1.5">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <Megaphone className="h-4 w-4 text-primary" /> {a.titulo}
            </p>
            <p className="text-sm text-muted-foreground whitespace-pre-line">{a.mensagem}</p>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void marcarLido(a.id)}>
              Ok, entendi
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
