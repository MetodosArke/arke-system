import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { diaBrasilia } from "@/lib/dataBrasilia";

/** Frequência na academia (check-in por QR ou catraca): presenças nos últimos 30 dias. */
export function PresencasAluno({ alunoId }: { alunoId: string }) {
  const { data } = useQuery({
    queryKey: ["presencas-aluno", alunoId],
    queryFn: async () => {
      const desde = diaBrasilia(-30);
      const { data: linhas, error } = await supabase
        .from("presencas")
        .select("dia")
        .eq("aluno_id", alunoId)
        .gte("dia", desde)
        .order("dia", { ascending: false });
      if (error) throw error;
      return linhas;
    },
  });
  if (!data) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {data.length} presença(s) nos últimos 30 dias
      {data[0] ? ` · última em ${new Date(`${data[0].dia}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
    </p>
  );
}
