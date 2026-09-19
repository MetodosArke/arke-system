import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Target, CheckCircle2, Sparkles } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type AlunoObjetivos = Tables<"aluno_objetivos">;

const OBJETIVOS_DISPONIVEIS = [
  "Emagrecer",
  "Ganhar massa muscular",
  "Melhorar condicionamento físico",
  "Reduzir estresse e ansiedade",
  "Aumentar energia e disposição",
  "Melhorar postura",
  "Aumentar flexibilidade",
  "Melhorar qualidade do sono",
  "Ganhar força",
  "Melhorar saúde do coração",
  "Aumentar autoestima",
  "Competir em eventos esportivos",
  "Prevenir doenças",
  "Socializar e fazer amigos",
  "Ter um estilo de vida mais ativo",
];

const MAX_OBJETIVOS = 3;

export default function ObjetivosTab() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRevising, setIsRevising] = useState(false);
  const [step, setStep] = useState<0 | 1>(0);
  const [conquistas, setConquistas] = useState("");
  const [dificuldades, setDificuldades] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [visao3Meses, setVisao3Meses] = useState("");
  const [visao3Anos, setVisao3Anos] = useState("");

  const { data: atual, isLoading } = useQuery({
    queryKey: ["aluno-objetivos", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_objetivos")
        .select("*")
        .eq("aluno_id", alunoId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as AlunoObjetivos | null;
    },
    enabled: !!alunoId,
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const objetivosFinais = selecionados.length > 0 ? selecionados : atual?.objetivos ?? [];
      const proximaRevisao = new Date();
      proximaRevisao.setMonth(proximaRevisao.getMonth() + 3);
      const { error } = await supabase.from("aluno_objetivos").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        objetivos: objetivosFinais,
        conquistas: conquistas.trim() || null,
        dificuldades: dificuldades.trim() || null,
        visao_3_meses: visao3Meses.trim() || null,
        visao_3_anos: visao3Anos.trim() || null,
        proxima_revisao: proximaRevisao.toISOString().slice(0, 10),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Objetivos atualizados!" });
      void queryClient.invalidateQueries({ queryKey: ["aluno-objetivos", alunoId] });
      encerrarRevisao();
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const iniciarRevisao = () => {
    setConquistas("");
    setDificuldades("");
    setSelecionados([]);
    setVisao3Meses(atual?.visao_3_meses ?? "");
    setVisao3Anos(atual?.visao_3_anos ?? "");
    setStep(0);
    setIsRevising(true);
  };

  const encerrarRevisao = () => setIsRevising(false);

  const toggleObjetivo = (objetivo: string) => {
    setSelecionados((prev) => {
      if (prev.includes(objetivo)) return prev.filter((o) => o !== objetivo);
      if (prev.length >= MAX_OBJETIVOS) return prev;
      return [...prev, objetivo];
    });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (isRevising) {
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          {step === 0 ? (
            <>
              <h3 className="font-semibold text-sm">Reflexão</h3>
              {atual && atual.objetivos.length > 0 && (
                <div className="border-l-4 border-primary/40 bg-primary/5 rounded-r-lg p-3 text-sm text-muted-foreground">
                  Seus objetivos atuais: {atual.objetivos.join(", ")}
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">O que você já conquistou?</label>
                <Textarea value={conquistas} onChange={(e) => setConquistas(e.target.value)} rows={3} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Quais dificuldades você encontrou?</label>
                <Textarea value={dificuldades} onChange={(e) => setDificuldades(e.target.value)} rows={3} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={encerrarRevisao}>
                  Cancelar
                </Button>
                <Button onClick={() => setStep(1)}>Continuar</Button>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-semibold text-sm">Escolha até {MAX_OBJETIVOS} objetivos</h3>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Selecione o que mais importa pra você agora</p>
                <Badge variant="secondary">{selecionados.length}/{MAX_OBJETIVOS} selecionados</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {OBJETIVOS_DISPONIVEIS.map((obj) => {
                  const isSelected = selecionados.includes(obj);
                  return (
                    <Button
                      key={obj}
                      type="button"
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      onClick={() => toggleObjetivo(obj)}
                    >
                      {obj}
                    </Button>
                  );
                })}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Como você se imagina em 3 meses?</label>
                <Textarea value={visao3Meses} onChange={(e) => setVisao3Meses(e.target.value)} rows={3} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">E em 3 anos?</label>
                <Textarea value={visao3Anos} onChange={(e) => setVisao3Anos(e.target.value)} rows={3} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep(0)}>
                  Voltar
                </Button>
                <Button
                  disabled={(selecionados.length === 0 && (atual?.objetivos.length ?? 0) === 0) || salvar.isPending}
                  onClick={() => salvar.mutate()}
                >
                  {salvar.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" /> Meus Objetivos
        </CardTitle>
        <Button size="sm" variant="outline" onClick={iniciarRevisao}>
          {atual ? "Revisar" : "Definir Objetivos"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!atual ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Sparkles className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Você ainda não definiu seus objetivos.</p>
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {atual.objetivos.map((obj) => (
                <li key={obj} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> {obj}
                </li>
              ))}
            </ul>
            {atual.visao_3_meses && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Em 3 meses</p>
                <p className="text-sm">{atual.visao_3_meses}</p>
              </div>
            )}
            {atual.visao_3_anos && (
              <div className="rounded-lg bg-primary/5 p-3">
                <p className="text-xs font-medium text-muted-foreground">Em 3 anos</p>
                <p className="text-sm">{atual.visao_3_anos}</p>
              </div>
            )}
            {atual.proxima_revisao && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 px-3 py-2 text-xs font-medium">
                Próxima revisão agendada: {new Date(atual.proxima_revisao).toLocaleDateString("pt-BR")}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
