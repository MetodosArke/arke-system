import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search, FileText } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { NovoTemplateDialog } from "./NovoTemplateDialog";
import { TemplateCard } from "./TemplateCard";

interface TemplatesListProps {
  alunos: { user_id: string; full_name: string }[];
}

export function TemplatesList({ alunos }: TemplatesListProps) {
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["admin-templates"],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("treino_templates") as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      // Exercises cascade delete via FK
      await (supabase.from("treino_templates") as any).delete().eq("id", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-templates"] });
      toast({ title: "Template removido!" });
    },
  });

  const searchLower = search.toLowerCase();
  const filtered = search
    ? templates.filter(
        (t: any) =>
          t.titulo.toLowerCase().includes(searchLower) ||
          (t.categoria && t.categoria.toLowerCase().includes(searchLower))
      )
    : templates;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Crie templates reutilizáveis e envie para seus alunos
          </p>
        </div>
        <NovoTemplateDialog />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou categoria..."
          className="pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {isLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12">
            <FileText className="h-10 w-10 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum template encontrado</p>
          </div>
        ) : (
          filtered.map((template: any) => (
            <TemplateCard
              key={template.id}
              template={template}
              onDelete={(id) => deleteTemplate.mutate(id)}
              alunos={alunos}
            />
          ))
        )}
      </div>
    </div>
  );
}
