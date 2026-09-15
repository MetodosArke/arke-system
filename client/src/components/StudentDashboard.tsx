import { useMemo } from "react";
import { Dumbbell, Utensils } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

function TreinoCard({ treino }: { treino: { id: string; titulo: string; tipo: string; descricao?: string | null; versao: number } }) {
  const exerciciosQuery = trpc.prescricao.meu.treinoExercicios.useQuery({ treinoId: treino.id });
  const exercicios = exerciciosQuery.data ?? [];
  const exercisesQuery = trpc.prescricao.exercises.useQuery();
  const exercises = exercisesQuery.data ?? [];
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">{treino.titulo} · {treino.tipo}</CardTitle><p className="text-xs text-[#918a7d]">Versão {treino.versao}</p></CardHeader><CardContent>
    {treino.descricao && <p className="mb-3 text-sm text-[#5c5445]">{treino.descricao}</p>}
    {exerciciosQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando exercícios...</p>}
    {!exerciciosQuery.isLoading && exercicios.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum exercício cadastrado neste treino ainda.</p>}
    <div className="space-y-2">{exercicios.map((item) => { const exercicio = exercises.find((ex) => ex.id === item.exercicio_id); return <div key={item.id} className="rounded-xl border border-[#eee9df] p-3"><p className="text-sm font-semibold text-[#4b4438]">{exercicio?.nome ?? "Exercício"}</p><p className="mt-1 text-xs text-[#9b9488]">{item.series} séries x {item.repeticoes} repetições · descanso {item.descanso_seg}s{item.observacoes ? ` · ${item.observacoes}` : ""}</p></div>; })}</div>
  </CardContent></Card>;
}

export function StudentDashboard() {
  const treinosQuery = trpc.prescricao.meu.treinos.useQuery();
  const dietasQuery = trpc.prescricao.meu.dietas.useQuery();
  const treinos = useMemo(() => treinosQuery.data ?? [], [treinosQuery.data]);
  const dietas = useMemo(() => dietasQuery.data ?? [], [dietasQuery.data]);

  return <div className="mx-auto max-w-[1100px] p-5 sm:p-8">
    <div className="mb-6"><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Meu treino</h2><p className="mt-1 text-sm text-[#77877d]">Seu treino e plano alimentar publicados pelo seu profissional.</p></div>

    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><Dumbbell size={14} /> Treinos</div>
    {treinosQuery.isLoading && <p className="text-sm text-[#918a7d]">Carregando...</p>}
    {!treinosQuery.isLoading && treinos.length === 0 && <div className="rounded-2xl border border-dashed border-[#dfd8c8] bg-[#fffdf9] p-8 text-center text-sm text-[#918a7d]">Nenhum treino publicado ainda. Assim que seu profissional publicar, ele aparece aqui.</div>}
    <div className="grid gap-4 sm:grid-cols-2">{treinos.map((treino) => <TreinoCard key={treino.id} treino={treino} />)}</div>

    <div className="mb-3 mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><Utensils size={14} /> Plano alimentar</div>
    {dietasQuery.isLoading && <p className="text-sm text-[#918a7d]">Carregando...</p>}
    {!dietasQuery.isLoading && dietas.length === 0 && <div className="rounded-2xl border border-dashed border-[#dfd8c8] bg-[#fffdf9] p-8 text-center text-sm text-[#918a7d]">Nenhum plano alimentar publicado ainda.</div>}
    <div className="grid gap-4 sm:grid-cols-2">{dietas.map((dieta) => <Card key={dieta.id} className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">{dieta.titulo}</CardTitle><p className="text-xs text-[#918a7d]">Versão {dieta.versao}</p></CardHeader><CardContent>{dieta.descricao && <p className="text-sm text-[#5c5445]">{dieta.descricao}</p>}{dieta.arquivo_url && <a href={dieta.arquivo_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-[#a47b13] underline">Abrir arquivo</a>}</CardContent></Card>)}</div>
  </div>;
}

export default StudentDashboard;
