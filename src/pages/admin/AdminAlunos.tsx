import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users } from "lucide-react";

const NIVEL_LABEL: Record<string, string> = {
  essencial: "Essencial",
  integrado: "Integrado",
  integral: "Integral",
};

export default function AdminAlunos() {
  const { organization } = useAuth();

  const { data: alunos = [], isLoading } = useQuery({
    queryKey: ["admin-alunos", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select("id, user_id, nivel_atacado, objetivo, data_inicio")
        .eq("organization_id", organization!.id)
        .order("data_inicio", { ascending: false });
      if (error) throw error;

      const userIds = alunosData.map((a) => a.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };

      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return alunosData.map((a) => ({ ...a, full_name: nomeByUserId.get(a.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Alunos</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
          {!isLoading && alunos.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhum aluno cadastrado ainda.</p>
          )}
          {alunos.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Objetivo</TableHead>
                  <TableHead>Desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alunos.map((aluno) => (
                  <TableRow key={aluno.id}>
                    <TableCell className="font-medium">{aluno.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{NIVEL_LABEL[aluno.nivel_atacado] ?? aluno.nivel_atacado}</Badge>
                    </TableCell>
                    <TableCell>{aluno.objetivo ?? "—"}</TableCell>
                    <TableCell>
                      {aluno.data_inicio ? new Date(aluno.data_inicio).toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
