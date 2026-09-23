import { hojeBrasilia } from "@/lib/dataBrasilia";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Medal, Crown, Clock } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Competicao = Tables<"competicoes">;

const METRICA_LABEL: Record<Competicao["metrica"], string> = {
  pontos_desafios: "Pontos em Desafios",
  treinos_concluidos: "Treinos Concluídos",
  km_total: "Quilometragem Total",
  dieta_adesao_media: "Média de Adesão à Dieta",
};

function RankingCompeticao({ competicaoId }: { competicaoId: string }) {
  const { alunoId } = useAuth();
  const { data: ranking = [], isLoading } = useQuery({
    queryKey: ["aluno-ranking-competicao", competicaoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_ranking_competicao", { p_competicao_id: competicaoId });
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <p className="text-xs text-muted-foreground">Carregando ranking...</p>;
  if (ranking.length === 0) return <p className="text-xs text-muted-foreground">Ainda sem dados registrados.</p>;

  const minhaPosicao = ranking.findIndex((r) => r.aluno_id === alunoId);

  return (
    <div className="space-y-2">
      {minhaPosicao >= 0 && (
        <div className="rounded-lg bg-primary/10 border border-primary/30 px-3 py-2 flex items-center justify-between">
          <span className="text-sm font-medium flex items-center gap-1.5">
            {minhaPosicao === 0 ? <Crown className="h-4 w-4 text-amber-500" /> : <Medal className="h-4 w-4 text-primary" />}
            Sua posição: {minhaPosicao + 1}º lugar
          </span>
          <span className="text-sm font-bold">{Number(ranking[minhaPosicao].valor).toFixed(1)}</span>
        </div>
      )}
      <div className="space-y-1">
        {ranking.slice(0, 10).map((r, idx) => (
          <div
            key={r.aluno_id}
            className={`flex items-center justify-between text-sm py-1 px-2 rounded ${r.aluno_id === alunoId ? "bg-muted/60" : ""}`}
          >
            <div className="flex items-center gap-2">
              <Badge
                variant={idx === 0 ? "default" : "outline"}
                className={`w-6 h-6 rounded-full p-0 flex items-center justify-center text-[10px] ${
                  idx === 1 ? "border-slate-400" : idx === 2 ? "border-amber-700" : ""
                }`}
              >
                {idx === 0 ? <Crown className="h-3 w-3" /> : idx + 1}
              </Badge>
              <span>
                {r.nome}
                {r.aluno_id === alunoId && <span className="text-xs text-muted-foreground"> (você)</span>}
              </span>
            </div>
            <span className="font-medium text-muted-foreground">{Number(r.valor).toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AlunoCompeticoes() {
  const { data: competicoes = [], isLoading } = useQuery({
    queryKey: ["aluno-competicoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("competicoes").select("*").order("data_inicio", { ascending: false });
      if (error) throw error;
      return data as Competicao[];
    },
  });

  const hoje = hojeBrasilia();
  const ativas = competicoes.filter((c) => c.data_inicio <= hoje && c.data_fim >= hoje);
  const pendentes = competicoes.filter((c) => c.data_inicio > hoje);
  const encerradas = competicoes.filter((c) => c.data_fim < hoje);

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Medal className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Competições</h1>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-primary">{ativas.length}</p>
            <p className="text-[10px] text-muted-foreground">Ativas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-muted-foreground">{encerradas.length}</p>
            <p className="text-[10px] text-muted-foreground">Encerradas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold">{competicoes.length}</p>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </CardContent>
        </Card>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!isLoading && competicoes.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhuma competição disponível no momento.</CardContent>
        </Card>
      )}

      {ativas.map((c) => (
        <Card key={c.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              {c.titulo}
              <Badge>Ativa</Badge>
            </CardTitle>
            {c.descricao && <p className="text-xs text-muted-foreground">{c.descricao}</p>}
            <p className="text-xs text-muted-foreground">{METRICA_LABEL[c.metrica]}</p>
          </CardHeader>
          <CardContent>
            <RankingCompeticao competicaoId={c.id} />
          </CardContent>
        </Card>
      ))}

      {pendentes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Em Breve</h2>
          {pendentes.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{c.titulo}</p>
                  <p className="text-xs text-muted-foreground">Começa em {new Date(c.data_inicio).toLocaleDateString("pt-BR")}</p>
                </div>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {encerradas.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Encerradas</h2>
          {encerradas.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  {c.titulo}
                  <Badge variant="secondary">Encerrada</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{METRICA_LABEL[c.metrica]}</p>
              </CardHeader>
              <CardContent>
                <RankingCompeticao competicaoId={c.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
