import { useMemo, useState } from "react";
import { Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type Toast = { title: string; detail: string };
type Tab = "treinos" | "dieta";

const emptyTreino = { titulo: "", tipo: "A", descricao: "" };
const emptyExercicio = { exercicioId: "", series: "3", repeticoes: "12", descansoSeg: "60", observacoes: "" };
const emptyDieta = { titulo: "", descricao: "", arquivoUrl: "" };

export function ProfessionalDashboard({ onToast }: { onToast: (toast: Toast) => void }) {
  const orgsQuery = trpc.prescricao.myOrganizations.useQuery();
  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";

  const studentsQuery = trpc.prescricao.students.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const students = studentsQuery.data ?? [];
  const [alunoId, setAlunoId] = useState("");
  const selectedAluno = students.find((student) => student.user_id === alunoId);

  const [tab, setTab] = useState<Tab>("treinos");
  const utils = trpc.useUtils();
  const success = (title: string) => { onToast({ title, detail: "Alteração persistida no Supabase." }); };
  const fail = (title: string, error: { message: string }) => onToast({ title, detail: error.message });

  // Treinos
  const treinosQuery = trpc.prescricao.treinos.list.useQuery({ alunoId }, { enabled: Boolean(alunoId) });
  const treinos = treinosQuery.data ?? [];
  const [treinoId, setTreinoId] = useState<string | null>(null);
  const [treinoForm, setTreinoForm] = useState(emptyTreino);
  const selectedTreino = treinos.find((treino) => treino.id === treinoId);
  const treinoExerciciosQuery = trpc.prescricao.treinos.exercicios.useQuery({ treinoId: treinoId ?? "" }, { enabled: Boolean(treinoId) });
  const treinoExercicios = treinoExerciciosQuery.data ?? [];
  const exercisesQuery = trpc.prescricao.exercises.useQuery();
  const exercises = exercisesQuery.data ?? [];
  const [exercicioForm, setExercicioForm] = useState(emptyExercicio);
  const refreshTreinos = () => { utils.prescricao.treinos.list.invalidate({ alunoId }); utils.prescricao.treinos.exercicios.invalidate({ treinoId: treinoId ?? "" }); };

  const createTreino = trpc.prescricao.treinos.create.useMutation({ onSuccess: (created) => { success("Treino criado como rascunho"); setTreinoId(created.id); setTreinoForm(emptyTreino); refreshTreinos(); }, onError: (e) => fail("Erro ao criar treino", e) });
  const updateTreino = trpc.prescricao.treinos.update.useMutation({ onSuccess: () => { success("Treino atualizado"); refreshTreinos(); }, onError: (e) => fail("Erro ao atualizar treino", e) });
  const saveExercicios = trpc.prescricao.treinos.saveExercicios.useMutation({ onSuccess: () => { success("Exercícios salvos"); setExercicioForm(emptyExercicio); refreshTreinos(); }, onError: (e) => fail("Erro ao salvar exercícios", e) });
  const publishTreino = trpc.prescricao.treinos.publish.useMutation({ onSuccess: () => { success("Treino publicado"); refreshTreinos(); }, onError: (e) => fail("Erro ao publicar treino", e) });
  const deleteTreino = trpc.prescricao.treinos.delete.useMutation({ onSuccess: () => { success("Treino removido"); setTreinoId(null); refreshTreinos(); }, onError: (e) => fail("Erro ao remover treino", e) });

  const beginTreino = (id: string) => { setTreinoId(id); setExercicioForm(emptyExercicio); };
  const saveTreinoHeader = () => { if (!treinoId) return; updateTreino.mutate({ id: treinoId, data: { titulo: treinoForm.titulo || selectedTreino?.titulo || "Treino", tipo: treinoForm.tipo || selectedTreino?.tipo || "A", descricao: treinoForm.descricao || undefined } }); };
  const addExercicio = () => {
    if (!treinoId || !exercicioForm.exercicioId) return;
    const items = [...treinoExercicios.map((item) => ({ exercicio_id: item.exercicio_id, series: item.series, repeticoes: item.repeticoes, descanso_seg: item.descanso_seg, observacoes: item.observacoes ?? undefined })), { exercicio_id: exercicioForm.exercicioId, series: Number(exercicioForm.series || 3), repeticoes: exercicioForm.repeticoes || "12", descanso_seg: Number(exercicioForm.descansoSeg || 60), observacoes: exercicioForm.observacoes || undefined }];
    saveExercicios.mutate({ treinoId, items });
  };
  const removeExercicio = (exercicioIdToRemove: string) => {
    if (!treinoId || !window.confirm("Remover este exercício do treino?")) return;
    const items = treinoExercicios.filter((item) => item.id !== exercicioIdToRemove).map((item) => ({ exercicio_id: item.exercicio_id, series: item.series, repeticoes: item.repeticoes, descanso_seg: item.descanso_seg, observacoes: item.observacoes ?? undefined }));
    saveExercicios.mutate({ treinoId, items });
  };

  // Dietas
  const dietasQuery = trpc.prescricao.dietas.list.useQuery({ alunoId }, { enabled: Boolean(alunoId) });
  const dietas = dietasQuery.data ?? [];
  const [dietaId, setDietaId] = useState<string | null>(null);
  const [dietaForm, setDietaForm] = useState(emptyDieta);
  const refreshDietas = () => utils.prescricao.dietas.list.invalidate({ alunoId });
  const createDieta = trpc.prescricao.dietas.create.useMutation({ onSuccess: (created) => { success("Plano alimentar criado como rascunho"); setDietaId(created.id); setDietaForm(emptyDieta); refreshDietas(); }, onError: (e) => fail("Erro ao criar plano alimentar", e) });
  const updateDieta = trpc.prescricao.dietas.update.useMutation({ onSuccess: () => { success("Plano alimentar atualizado"); refreshDietas(); }, onError: (e) => fail("Erro ao atualizar plano alimentar", e) });
  const publishDieta = trpc.prescricao.dietas.publish.useMutation({ onSuccess: () => { success("Plano alimentar publicado"); refreshDietas(); }, onError: (e) => fail("Erro ao publicar plano alimentar", e) });
  const deleteDieta = trpc.prescricao.dietas.delete.useMutation({ onSuccess: () => { success("Plano alimentar removido"); setDietaId(null); refreshDietas(); }, onError: (e) => fail("Erro ao remover plano alimentar", e) });
  const selectedDieta = dietas.find((dieta) => dieta.id === dietaId);
  const beginDieta = (id: string) => { const dieta = dietas.find((item) => item.id === id); setDietaId(id); setDietaForm({ titulo: dieta?.titulo ?? "", descricao: dieta?.descricao ?? "", arquivoUrl: dieta?.arquivo_url ?? "" }); };
  const saveDietaHeader = () => { if (!dietaId) return; updateDieta.mutate({ id: dietaId, data: { titulo: dietaForm.titulo || selectedDieta?.titulo || "Plano alimentar", descricao: dietaForm.descricao || null, arquivo_url: dietaForm.arquivoUrl || null } }); };

  const selectAluno = (id: string) => { setAlunoId(id); setTreinoId(null); setDietaId(null); setTab("treinos"); };

  if (orgsQuery.isLoading) return <div className="p-8 text-sm text-[#918a7d]">Carregando organizações...</div>;
  if (!organizations.length) return <div className="mx-auto max-w-lg p-8 text-center text-sm text-[#918a7d]">Sua conta não está vinculada a nenhuma organização como profissional. Peça para o administrador te convidar.</div>;

  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Meus alunos</h2><p className="mt-1 text-sm text-[#77877d]">Gerencie treino e plano alimentar dos alunos da sua organização.</p></div>
      {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => { setOrganizationId(e.target.value); setAlunoId(""); }} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
    </div>
    <div className="grid gap-5 lg:grid-cols-[.7fr_1.3fr]">
      <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Alunos</CardTitle></CardHeader><CardContent className="space-y-1">
        {studentsQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando alunos...</p>}
        {!studentsQuery.isLoading && students.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum aluno cadastrado nesta organização ainda.</p>}
        {students.map((student) => <button key={student.user_id} onClick={() => selectAluno(student.user_id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${alunoId === student.user_id ? "bg-[#15130f] font-semibold text-white" : "text-[#4b4438] hover:bg-[#faf7ef]"}`}>{student.full_name || "Aluno sem nome"}</button>)}
      </CardContent></Card>

      <div>
        {!selectedAluno && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-8 text-center text-sm text-[#918a7d]">Selecione um aluno para gerenciar treino e plano alimentar.</CardContent></Card>}
        {selectedAluno && <>
          <div className="mb-4 flex gap-2"><Button variant={tab === "treinos" ? "default" : "outline"} onClick={() => setTab("treinos")} className="h-9 rounded-xl text-xs">Treinos</Button><Button variant={tab === "dieta" ? "default" : "outline"} onClick={() => setTab("dieta")} className="h-9 rounded-xl text-xs">Plano alimentar</Button></div>

          {tab === "treinos" && <div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Treinos de {selectedAluno.full_name}</CardTitle></CardHeader><CardContent className="space-y-2">
              {treinos.map((treino) => <div key={treino.id} className={`flex items-center justify-between rounded-xl border p-2.5 ${treinoId === treino.id ? "border-[#15130f]" : "border-[#eee9df]"}`}><button onClick={() => beginTreino(treino.id)} className="min-w-0 flex-1 text-left"><p className="truncate text-xs font-semibold text-[#4b4438]">{treino.titulo} · {treino.tipo}</p><p className="text-[10px] text-[#9b9488]">{treino.estado_publicacao} · v{treino.versao}</p></button><Button variant="ghost" onClick={() => { if (window.confirm("Remover este treino?")) deleteTreino.mutate({ id: treino.id }); }} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>)}
              {treinos.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum treino criado ainda.</p>}
              <div className="mt-3 space-y-2 rounded-xl bg-[#faf7ef] p-3"><p className="text-xs font-semibold text-[#4b4438]">Novo treino</p><div className="grid grid-cols-[1fr_80px] gap-2"><Input value={treinoForm.titulo} onChange={(e) => setTreinoForm({ ...treinoForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" /><Input value={treinoForm.tipo} onChange={(e) => setTreinoForm({ ...treinoForm, tipo: e.target.value })} placeholder="Tipo" className="h-9 rounded-lg text-xs" /></div><textarea value={treinoForm.descricao} onChange={(e) => setTreinoForm({ ...treinoForm, descricao: e.target.value })} placeholder="Descrição (opcional)" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" /><Button onClick={() => createTreino.mutate({ alunoId, titulo: treinoForm.titulo, tipo: treinoForm.tipo || "A", descricao: treinoForm.descricao || undefined })} disabled={!treinoForm.titulo} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Criar rascunho</Button></div>
            </CardContent></Card>

            {selectedTreino && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">{selectedTreino.titulo} · {selectedTreino.tipo}</CardTitle><p className="text-[10px] text-[#9b9488]">{selectedTreino.estado_publicacao} · versão {selectedTreino.versao}</p></CardHeader><CardContent className="space-y-4">
              <div className="grid grid-cols-[1fr_80px] gap-2"><Input defaultValue={selectedTreino.titulo} onChange={(e) => setTreinoForm({ ...treinoForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" /><Input defaultValue={selectedTreino.tipo} onChange={(e) => setTreinoForm({ ...treinoForm, tipo: e.target.value })} placeholder="Tipo" className="h-9 rounded-lg text-xs" /></div>
              <textarea defaultValue={selectedTreino.descricao ?? ""} onChange={(e) => setTreinoForm({ ...treinoForm, descricao: e.target.value })} placeholder="Descrição" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" />
              <div className="flex gap-2"><Button variant="outline" onClick={saveTreinoHeader} className="h-9 flex-1 rounded-lg text-xs"><Save size={14} /> Salvar</Button><Button onClick={() => publishTreino.mutate({ id: selectedTreino.id })} disabled={publishTreino.isPending} className="h-9 flex-1 rounded-lg bg-[#15130f] text-xs text-white"><Send size={14} /> Publicar</Button></div>

              <div className="rounded-xl border border-[#eee9df] p-3"><p className="mb-2 text-xs font-semibold text-[#4b4438]">Exercícios</p>
                <div className="mb-3 space-y-2">{treinoExercicios.map((item) => { const exercicio = exercises.find((ex) => ex.id === item.exercicio_id); return <div key={item.id} className="flex items-center gap-2 rounded-lg border border-[#eee9df] p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#4b4438]">{exercicio?.nome ?? "Exercício removido"}</p><p className="text-[10px] text-[#9b9488]">{item.series}x{item.repeticoes} · descanso {item.descanso_seg}s{item.observacoes ? ` · ${item.observacoes}` : ""}</p></div><Button variant="ghost" onClick={() => removeExercicio(item.id)} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>; })}
                {treinoExercicios.length === 0 && <p className="text-[10px] text-[#918a7d]">Nenhum exercício adicionado.</p>}</div>
                <div className="grid gap-2 sm:grid-cols-5"><select value={exercicioForm.exercicioId} onChange={(e) => setExercicioForm({ ...exercicioForm, exercicioId: e.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs sm:col-span-2"><option value="">Selecione o exercício</option>{exercises.map((ex) => <option key={ex.id} value={ex.id}>{ex.nome}</option>)}</select><Input value={exercicioForm.series} onChange={(e) => setExercicioForm({ ...exercicioForm, series: e.target.value })} placeholder="Séries" type="number" className="h-9 rounded-lg text-xs" /><Input value={exercicioForm.repeticoes} onChange={(e) => setExercicioForm({ ...exercicioForm, repeticoes: e.target.value })} placeholder="Repetições" className="h-9 rounded-lg text-xs" /><Input value={exercicioForm.descansoSeg} onChange={(e) => setExercicioForm({ ...exercicioForm, descansoSeg: e.target.value })} placeholder="Descanso (s)" type="number" className="h-9 rounded-lg text-xs" /></div>
                <Input value={exercicioForm.observacoes} onChange={(e) => setExercicioForm({ ...exercicioForm, observacoes: e.target.value })} placeholder="Observações (opcional)" className="mt-2 h-9 rounded-lg text-xs" />
                <Button onClick={addExercicio} disabled={!exercicioForm.exercicioId} className="mt-2 h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Adicionar exercício</Button>
              </div>
            </CardContent></Card>}
          </div>}

          {tab === "dieta" && <div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Planos de {selectedAluno.full_name}</CardTitle></CardHeader><CardContent className="space-y-2">
              {dietas.map((dieta) => <div key={dieta.id} className={`flex items-center justify-between rounded-xl border p-2.5 ${dietaId === dieta.id ? "border-[#15130f]" : "border-[#eee9df]"}`}><button onClick={() => beginDieta(dieta.id)} className="min-w-0 flex-1 text-left"><p className="truncate text-xs font-semibold text-[#4b4438]">{dieta.titulo}</p><p className="text-[10px] text-[#9b9488]">{dieta.estado_publicacao} · v{dieta.versao}</p></button><Button variant="ghost" onClick={() => { if (window.confirm("Remover este plano alimentar?")) deleteDieta.mutate({ id: dieta.id }); }} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>)}
              {dietas.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum plano alimentar criado ainda.</p>}
              <div className="mt-3 space-y-2 rounded-xl bg-[#faf7ef] p-3"><p className="text-xs font-semibold text-[#4b4438]">Novo plano alimentar</p><Input value={dietaForm.titulo} onChange={(e) => setDietaForm({ ...dietaForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" /><textarea value={dietaForm.descricao} onChange={(e) => setDietaForm({ ...dietaForm, descricao: e.target.value })} placeholder="Descrição (opcional)" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" /><Input value={dietaForm.arquivoUrl} onChange={(e) => setDietaForm({ ...dietaForm, arquivoUrl: e.target.value })} placeholder="Link do arquivo (opcional)" className="h-9 rounded-lg text-xs" /><Button onClick={() => createDieta.mutate({ alunoId, titulo: dietaForm.titulo, descricao: dietaForm.descricao || undefined, arquivoUrl: dietaForm.arquivoUrl || undefined })} disabled={!dietaForm.titulo} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Criar rascunho</Button></div>
            </CardContent></Card>

            {selectedDieta && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">{selectedDieta.titulo}</CardTitle><p className="text-[10px] text-[#9b9488]">{selectedDieta.estado_publicacao} · versão {selectedDieta.versao}</p></CardHeader><CardContent className="space-y-3">
              <Input value={dietaForm.titulo} onChange={(e) => setDietaForm({ ...dietaForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" />
              <textarea value={dietaForm.descricao} onChange={(e) => setDietaForm({ ...dietaForm, descricao: e.target.value })} placeholder="Descrição" className="min-h-24 w-full rounded-lg border bg-white p-2 text-xs" />
              <Input value={dietaForm.arquivoUrl} onChange={(e) => setDietaForm({ ...dietaForm, arquivoUrl: e.target.value })} placeholder="Link do arquivo" className="h-9 rounded-lg text-xs" />
              <div className="flex gap-2"><Button variant="outline" onClick={saveDietaHeader} className="h-9 flex-1 rounded-lg text-xs"><Save size={14} /> Salvar</Button><Button onClick={() => publishDieta.mutate({ id: selectedDieta.id })} disabled={publishDieta.isPending} className="h-9 flex-1 rounded-lg bg-[#15130f] text-xs text-white"><Send size={14} /> Publicar</Button></div>
            </CardContent></Card>}
          </div>}
        </>}
      </div>
    </div>
  </div>;
}

export default ProfessionalDashboard;
