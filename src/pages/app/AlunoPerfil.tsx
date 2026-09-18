import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, Ruler } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

export default function AlunoPerfil() {
  const { user, profile, organization, alunoId, signOut } = useAuth();

  const { data: avaliacoes = [] } = useQuery({
    queryKey: ["minhas-avaliacoes-fisicas", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avaliacoes_fisicas")
        .select("*")
        .eq("aluno_id", alunoId!)
        .order("data_avaliacao", { ascending: false });
      if (error) throw error;
      return data as Tables<"avaliacoes_fisicas">[];
    },
    enabled: !!alunoId,
  });

  const initials = profile?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-md mx-auto space-y-4">
      <Card>
        <CardHeader className="items-center text-center">
          <Avatar className="h-20 w-20">
            <AvatarImage src={profile?.avatar_url || undefined} />
            <AvatarFallback className="text-xl">{initials || "AR"}</AvatarFallback>
          </Avatar>
          <CardTitle>{profile?.full_name || "Aluno"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex justify-between border-b border-border py-2">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between border-b border-border py-2">
              <span className="text-muted-foreground">Academia</span>
              <span className="font-medium">{organization?.nome ?? "—"}</span>
            </div>
          </div>
          <Button variant="destructive" className="w-full" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </CardContent>
      </Card>

      {avaliacoes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Ruler className="h-4 w-4" /> Histórico de Avaliações Físicas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {avaliacoes.map((av) => (
              <div key={av.id} className="rounded-lg border border-border p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {new Date(av.data_avaliacao).toLocaleDateString("pt-BR")}
                  </span>
                  {av.imc != null && <span className="text-xs text-muted-foreground">IMC {av.imc}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  {av.peso_kg != null && <span>Peso: {av.peso_kg}kg</span>}
                  {av.altura_cm != null && <span>Altura: {av.altura_cm}cm</span>}
                  {av.percentual_gordura != null && <span>Gordura: {av.percentual_gordura}%</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
