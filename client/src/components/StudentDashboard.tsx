import { useMemo, useState } from "react";
import { ClipboardList, Dumbbell, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const emptyAcolhimento = { rotina_diaria: "", experiencias_exercicio: "", experiencias_gostou: "", experiencias_nao_gostou: "", dores_lesoes: "", medicamentos: "", tempo_disponivel: "", estilo_treino: "", exercicios_nao_gosta: "", alimentos_gosta: "", alimentos_nao_gosta: "", alimentacao_rotina: "" };

const ACOLHIMENTO_QUESTIONS: Array<[string, keyof typeof emptyAcolhimento]> = [
  ["Como é sua rotina diária?", "rotina_diaria"],
  ["Você já treinou antes? Como foi essa experiência?", "experiencias_exercicio"],
  ["O que você gostou em experiências anteriores?", "experiencias_gostou"],
  ["O que você não gostou?", "experiencias_nao_gostou"],
  ["Tem alguma dor ou lesão que devemos saber?", "dores_lesoes"],
  ["Usa algum medicamento?", "medicamentos"],
  ["Quanto tempo por semana você tem disponível para treinar?", "tempo_disponivel"],
  ["Que estilo de treino você prefere?", "estilo_treino"],
  ["Tem algum exercício que você não gosta?", "exercicios_nao_gosta"],
  ["Quais alimentos você gosta?", "alimentos_gosta"],
  ["Quais alimentos você não gosta ou não pode comer?", "alimentos_nao_gosta"],
  ["Como é sua alimentação no dia a dia?", "alimentacao_rotina"],
];

function AcolhimentoForm({ initial, onSaved }: { initial?: Partial<typeof emptyAcolhimento>; onSaved: () => void }) {
  const [form, setForm] = useState({ ...emptyAcolhimento, ...initial });
  const submit = trpc.journey.submitAcolhimento.useMutation({ onSuccess: onSaved });
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm">
    <CardHeader><CardTitle className="text-base text-[#2b271f]">Vamos te conhecer melhor</CardTitle><p className="text-xs text-[#918a7d]">Essas respostas ajudam seu profissional a montar um plano sob medida para você.</p></CardHeader>
    <CardContent className="space-y-4">
      {ACOLHIMENTO_QUESTIONS.map(([question, field]) => <div key={field}><label className="mb-1 block text-xs font-semibold text-[#4b4438]">{question}</label><textarea value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} className="min-h-16 w-full rounded-lg border border-[#e2dcca] bg-white p-2 text-xs" /></div>)}
      {submit.error && <p className="rounded-xl bg-[#f8e6df] px-3 py-2 text-xs text-[#b65343]">{submit.error.message}</p>}
      <Button onClick={() => submit.mutate(Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim().length > 0)))} disabled={submit.isPending} className="h-11 w-full rounded-xl bg-[#15130f] text-sm font-semibold text-white">Enviar respostas</Button>
    </CardContent>
  </Card>;
}

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
  const acolhimentoQuery = trpc.journey.myAcolhimento.useQuery();
  const [editingAcolhimento, setEditingAcolhimento] = useState(false);

  return <div className="mx-auto max-w-[1100px] p-5 sm:p-8">
    <div className="mb-6"><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Meu treino</h2><p className="mt-1 text-sm text-[#77877d]">Seu treino e plano alimentar publicados pelo seu profissional.</p></div>

    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><ClipboardList size={14} /> Acolhimento</div>
    {!acolhimentoQuery.isLoading && !acolhimentoQuery.data && <div className="mb-8"><AcolhimentoForm onSaved={() => acolhimentoQuery.refetch()} /></div>}
    {!acolhimentoQuery.isLoading && acolhimentoQuery.data && !editingAcolhimento && <div className="mb-8 rounded-2xl border border-[#e5ece5] bg-white p-4 shadow-sm"><p className="text-sm text-[#4b4438]">Suas respostas do acolhimento já foram enviadas ao seu profissional.</p><Button variant="outline" onClick={() => setEditingAcolhimento(true)} className="mt-3 h-9 rounded-xl text-xs">Editar respostas</Button></div>}
    {!acolhimentoQuery.isLoading && acolhimentoQuery.data && editingAcolhimento && <div className="mb-8"><AcolhimentoForm initial={Object.fromEntries(Object.keys(emptyAcolhimento).map((key) => [key, acolhimentoQuery.data?.[key as keyof typeof emptyAcolhimento] ?? ""]))} onSaved={() => { acolhimentoQuery.refetch(); setEditingAcolhimento(false); }} /></div>}

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
