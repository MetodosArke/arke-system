import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { porLotes } from "@/lib/paginar";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { ROTULO_FILTRO_TREINO, situacaoDoTreino, type FiltroTreino } from "@/lib/situacaoTreino";
import { ROTULO_PLANO, type PlanoAluno } from "@/lib/planoAluno";
import {
  filtrarCarteira,
  ROTULO_FASE,
  ROTULO_FILTRO_AVALIACAO,
  ROTULO_FILTRO_DIETA,
  rotuloAtencao,
  situacaoDaAvaliacao,
  travaOAluno,
  type FiltroCarteira,
  type SituacaoAvaliacao,
  type SituacaoDieta,
} from "@/lib/carteiraMentor";
import { decimal } from "@/lib/numeros";

type AlunoDaCarteira = {
  aluno_id: string;
  aluno_nome: string;
  organization_id: string;
  organizacao_nome: string;
  plano: string;
  fase: string;
  mentor_id: string | null;
  mentor_nome: string | null;
  situacao_academia: string;
  dias_inativo: number | null;
  constancia: number | null;
  atencao: string[] | null;
  nao_lidas: number;
};

const FILTROS: { valor: FiltroCarteira; rotulo: string }[] = [
  { valor: "atencao", rotulo: "Pedem atenção" },
  { valor: "meus", rotulo: "Meus alunos" },
  { valor: "sem_mentor", rotulo: "Sem mentor" },
  { valor: "todos", rotulo: "Todos" },
];

/**
 * A carteira do Método: todos os alunos que a ArkeFit acompanha, de todas as
 * academias, com o que pede atenção primeiro. É o ponto de entrada do mentor;
 * os chamados passam a ser uma parte do aluno, e não o contrário.
 */
export function CarteiraMentor() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [filtro, setFiltro] = useState<FiltroCarteira>("atencao");
  const [busca, setBusca] = useState("");
  const [filtroTreino, setFiltroTreino] = useState<FiltroTreino>("todos");
  const [filtroDieta, setFiltroDieta] = useState<"todos" | SituacaoDieta>("todos");
  const [filtroAvaliacao, setFiltroAvaliacao] = useState<"todos" | SituacaoAvaliacao>("todos");

  const { data: carteira = [], isLoading, error } = useQuery({
    // A carteira responde por quem pergunta (o papel na equipe da ArkeFit).
    queryKey: ["carteira-mentor", user?.id ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_carteira_mentor", { _limite: 500 });
      if (error) throw error;
      return (data ?? []) as AlunoDaCarteira[];
    },
    refetchInterval: 60_000,
  });

  // Treino, dieta e avaliação de cada aluno, para os filtros por módulo: o
  // ativo mais recente e a última avaliação. A mentoria lê os três pelo RLS
  // (equipe_metodo e aluno no Método).
  const ids = useMemo(() => carteira.map((a) => a.aluno_id).sort(), [carteira]);
  const { data: modulos, error: erroModulos } = useQuery({
    queryKey: ["carteira-mentor-modulos", ids],
    queryFn: async () => {
      const [treinos, dietas, avaliacoes] = await Promise.all([
        porLotes(ids, (lote) => supabase.from("treinos").select("aluno_id, validade_fim, created_at").eq("status", "ativo").in("aluno_id", lote)),
        porLotes(ids, (lote) => supabase.from("dietas").select("aluno_id").eq("status", "ativo").in("aluno_id", lote)),
        porLotes(ids, (lote) => supabase.from("avaliacoes_fisicas").select("aluno_id, data_avaliacao, data_proxima_avaliacao").in("aluno_id", lote)),
      ]);
      const treino = new Map<string, { validade_fim: string | null }>();
      for (const t of [...treinos].sort((a, b) => a.created_at.localeCompare(b.created_at))) treino.set(t.aluno_id, t);
      const avaliacao = new Map<string, { data_proxima_avaliacao: string | null }>();
      for (const v of [...avaliacoes].sort((a, b) => a.data_avaliacao.localeCompare(b.data_avaliacao))) avaliacao.set(v.aluno_id, v);
      return { treino, dieta: new Set(dietas.map((d) => d.aluno_id)), avaliacao };
    },
    enabled: ids.length > 0,
  });
  const hoje = hojeBrasilia();
  const situacoes = (alunoId: string) => ({
    treino: situacaoDoTreino(modulos?.treino.get(alunoId), hoje),
    dieta: (modulos?.dieta.has(alunoId) ? "com_dieta" : "sem_dieta") as SituacaoDieta,
    avaliacao: situacaoDaAvaliacao(modulos?.avaliacao.get(alunoId), hoje),
  });
  const filtrandoModulos = filtroTreino !== "todos" || filtroDieta !== "todos" || filtroAvaliacao !== "todos";
  const visiveis = filtrarCarteira(carteira, filtro, user?.id ?? null, busca).filter((a) => {
    if (!filtrandoModulos || !modulos) return true;
    const m = situacoes(a.aluno_id);
    return (
      (filtroTreino === "todos" || m.treino === filtroTreino) &&
      (filtroDieta === "todos" || m.dieta === filtroDieta) &&
      (filtroAvaliacao === "todos" || m.avaliacao === filtroAvaliacao)
    );
  });
  const contagem = (f: FiltroCarteira) => filtrarCarteira(carteira, f, user?.id ?? null).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.valor}
            size="sm"
            variant={filtro === f.valor ? "default" : "outline"}
            aria-pressed={filtro === f.valor}
            onClick={() => setFiltro(f.valor)}
          >
            {f.rotulo} ({contagem(f.valor)})
          </Button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Buscar aluno ou academia"
            placeholder="Buscar aluno ou academia"
            className="pl-8"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filtroTreino} onValueChange={(v) => setFiltroTreino(v as FiltroTreino)}>
          <SelectTrigger className="w-48" aria-label="Filtrar por treino"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULO_FILTRO_TREINO) as FiltroTreino[]).map((f) => (
              <SelectItem key={f} value={f}>{ROTULO_FILTRO_TREINO[f]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroDieta} onValueChange={(v) => setFiltroDieta(v as "todos" | SituacaoDieta)}>
          <SelectTrigger className="w-44" aria-label="Filtrar por dieta"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULO_FILTRO_DIETA) as ("todos" | SituacaoDieta)[]).map((f) => (
              <SelectItem key={f} value={f}>{ROTULO_FILTRO_DIETA[f]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroAvaliacao} onValueChange={(v) => setFiltroAvaliacao(v as "todos" | SituacaoAvaliacao)}>
          <SelectTrigger className="w-52" aria-label="Filtrar por avaliação física"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULO_FILTRO_AVALIACAO) as ("todos" | SituacaoAvaliacao)[]).map((f) => (
              <SelectItem key={f} value={f}>{ROTULO_FILTRO_AVALIACAO[f]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {erroModulos && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Não foi possível carregar o treino, a dieta e a avaliação dos alunos: os filtros por módulo estão sem efeito.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Não foi possível carregar a carteira: {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando carteira...</p>
      ) : visiveis.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Users className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium">
              {carteira.length === 0 ? "Nenhum aluno no Método ARKE ainda" : "Nenhum aluno neste filtro"}
            </p>
            <p className="text-sm text-muted-foreground">
              {carteira.length === 0
                ? "O aluno aparece aqui assim que a academia registra a adesão dele ao Método."
                : "Troque o filtro ou a busca para ver os outros."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((a) => {
            const sinais = a.atencao ?? [];
            const m = modulos ? situacoes(a.aluno_id) : null;
            const pendencias = m
              ? [
                  m.treino === "vencido" && "Treino vencido",
                  m.treino === "sem_treino" && "Sem treino",
                  m.dieta === "sem_dieta" && "Sem dieta",
                  m.avaliacao === "atrasada" && "Avaliação atrasada",
                  m.avaliacao === "sem_avaliacao" && "Sem avaliação",
                ].filter((p): p is string => !!p)
              : [];
            return (
              <button
                key={a.aluno_id}
                onClick={() => navigate(`/superadmin/mentoria/aluno/${a.aluno_id}`)}
                className="rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold truncate">{a.aluno_nome}</span>
                  {Number(a.nao_lidas) > 0 && <Badge variant="destructive">{a.nao_lidas}</Badge>}
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {a.organizacao_nome} · {ROTULO_PLANO[a.plano as PlanoAluno] ?? a.plano} · {ROTULO_FASE[a.fase] ?? a.fase}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {a.mentor_nome ? `Mentor: ${a.mentor_nome}` : "Sem mentor"}
                  {" · "}
                  {a.dias_inativo == null ? "sem sinal ainda" : `${a.dias_inativo} dia(s) sem sinal`}
                  {a.constancia != null && ` · constância ${decimal(Number(a.constancia), 0)}%`}
                </p>
                {pendencias.length > 0 && (
                  <p className="mt-1 text-[11px] text-warning">{pendencias.join(" · ")}</p>
                )}
                {sinais.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {sinais.map((s) => (
                      <Badge key={s} variant={travaOAluno(s) ? "destructive" : "outline"} className="text-[10px]">
                        {rotuloAtencao(s)}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
