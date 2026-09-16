import { useMemo, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type Toast = { title: string; detail: string };
type DesafioTipo = "livre" | "sem_doce" | "sem_alcool" | "consumo_agua" | "numero_treinos" | "quilometros" | "modalidades" | "desempenho_dieta";

const TIPOS_DESAFIO: Array<{ value: DesafioTipo; label: string }> = [
  { value: "livre", label: "Desafio livre" },
  { value: "sem_doce", label: "Sem doce" },
  { value: "sem_alcool", label: "Sem álcool" },
  { value: "consumo_agua", label: "Consumo de água (ml)" },
  { value: "numero_treinos", label: "Número de treinos" },
  { value: "quilometros", label: "Quilômetros" },
  { value: "modalidades", label: "Modalidades" },
  { value: "desempenho_dieta", label: "Desempenho na dieta (%)" },
];

const emptyDesafio: { titulo: string; descricao: string; tipo: DesafioTipo; metaValor: string; dataInicio: string; dataFim: string; pontos: string; paraTodos: boolean } = { titulo: "", descricao: "", tipo: "livre", metaValor: "", dataInicio: "", dataFim: "", pontos: "10", paraTodos: true };
const emptyCompeticao = { titulo: "", descricao: "", metrica: "Pontuação geral", dataInicio: "", dataFim: "", paraTodos: true };

export function DesafiosAdmin({ onToast }: { onToast: (toast: Toast) => void }) {
  const [section, setSection] = useState<"desafios" | "competicoes">("desafios");
  const orgsQuery = trpc.prescricao.myOrganizations.useQuery();
  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";

  const utils = trpc.useUtils();
  const success = (title: string) => onToast({ title, detail: "Alteração persistida no Supabase." });
  const fail = (title: string, error: { message: string }) => onToast({ title, detail: error.message });

  const studentsQuery = trpc.prescricao.students.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const students = studentsQuery.data ?? [];

  const desafiosQuery = trpc.prescricao.desafios.list.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const desafios = desafiosQuery.data ?? [];
  const [desafioId, setDesafioId] = useState<string | null>(null);
  const selectedDesafio = desafios.find((desafio) => desafio.id === desafioId);
  const [form, setForm] = useState(emptyDesafio);
  const refreshDesafios = () => utils.prescricao.desafios.list.invalidate({ organizationId: activeOrgId });

  const createDesafio = trpc.prescricao.desafios.create.useMutation({ onSuccess: (created) => { success("Desafio criado"); setDesafioId(created.id); setForm(emptyDesafio); refreshDesafios(); }, onError: (e) => fail("Erro ao criar desafio", e) });
  const deleteDesafio = trpc.prescricao.desafios.delete.useMutation({ onSuccess: () => { success("Desafio removido"); setDesafioId(null); refreshDesafios(); }, onError: (e) => fail("Erro ao remover desafio", e) });

  const participantesQuery = trpc.prescricao.desafios.participantes.list.useQuery({ desafioId: desafioId ?? "" }, { enabled: Boolean(desafioId) && !selectedDesafio?.para_todos });
  const participanteIds = new Set((participantesQuery.data ?? []).map((participante) => participante.aluno_id));
  const refreshParticipantes = () => utils.prescricao.desafios.participantes.list.invalidate({ desafioId: desafioId ?? "" });
  const addParticipante = trpc.prescricao.desafios.participantes.add.useMutation({ onSuccess: refreshParticipantes, onError: (e) => fail("Erro ao adicionar aluno", e) });
  const removeParticipante = trpc.prescricao.desafios.participantes.remove.useMutation({ onSuccess: refreshParticipantes, onError: (e) => fail("Erro ao remover aluno", e) });

  const progressoQuery = trpc.prescricao.desafios.progresso.list.useQuery({ desafioId: desafioId ?? "" }, { enabled: Boolean(desafioId) });
  const progressoByAluno = new Map((progressoQuery.data ?? []).map((item) => [item.aluno_id, item]));
  const setProgresso = trpc.prescricao.desafios.progresso.set.useMutation({ onSuccess: () => utils.prescricao.desafios.progresso.list.invalidate({ desafioId: desafioId ?? "" }), onError: (e) => fail("Erro ao atualizar progresso", e) });
  const [valorDrafts, setValorDrafts] = useState<Record<string, string>>({});

  const submitDesafio = () => createDesafio.mutate({
    organizationId: activeOrgId,
    titulo: form.titulo,
    descricao: form.descricao || undefined,
    tipo: form.tipo,
    metaValor: form.metaValor ? Number(form.metaValor) : undefined,
    dataInicio: form.dataInicio,
    dataFim: form.dataFim,
    pontos: Number(form.pontos || 10),
    paraTodos: form.paraTodos,
  });

  const elegiveis = selectedDesafio?.para_todos ? students : students.filter((student) => participanteIds.has(student.user_id));

  const competicoesQuery = trpc.prescricao.competicoes.list.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const competicoes = competicoesQuery.data ?? [];
  const [competicaoId, setCompeticaoId] = useState<string | null>(null);
  const selectedCompeticao = competicoes.find((competicao) => competicao.id === competicaoId);
  const [competicaoForm, setCompeticaoForm] = useState(emptyCompeticao);
  const refreshCompeticoes = () => utils.prescricao.competicoes.list.invalidate({ organizationId: activeOrgId });

  const createCompeticao = trpc.prescricao.competicoes.create.useMutation({ onSuccess: (created) => { success("Competição criada"); setCompeticaoId(created.id); setCompeticaoForm(emptyCompeticao); refreshCompeticoes(); }, onError: (e) => fail("Erro ao criar competição", e) });
  const deleteCompeticao = trpc.prescricao.competicoes.delete.useMutation({ onSuccess: () => { success("Competição removida"); setCompeticaoId(null); refreshCompeticoes(); }, onError: (e) => fail("Erro ao remover competição", e) });

  const compParticipantesQuery = trpc.prescricao.competicoes.participantes.list.useQuery({ competicaoId: competicaoId ?? "" }, { enabled: Boolean(competicaoId) && !selectedCompeticao?.para_todos });
  const compParticipanteIds = new Set((compParticipantesQuery.data ?? []).map((participante) => participante.aluno_id));
  const refreshCompParticipantes = () => utils.prescricao.competicoes.participantes.list.invalidate({ competicaoId: competicaoId ?? "" });
  const addCompParticipante = trpc.prescricao.competicoes.participantes.add.useMutation({ onSuccess: refreshCompParticipantes, onError: (e) => fail("Erro ao adicionar aluno", e) });
  const removeCompParticipante = trpc.prescricao.competicoes.participantes.remove.useMutation({ onSuccess: refreshCompParticipantes, onError: (e) => fail("Erro ao remover aluno", e) });

  const pontuacaoQuery = trpc.prescricao.competicoes.pontuacao.list.useQuery({ competicaoId: competicaoId ?? "" }, { enabled: Boolean(competicaoId) });
  const pontuacaoByAluno = new Map((pontuacaoQuery.data ?? []).map((item) => [item.aluno_id, item.valor]));
  const setPontuacao = trpc.prescricao.competicoes.pontuacao.set.useMutation({ onSuccess: () => utils.prescricao.competicoes.pontuacao.list.invalidate({ competicaoId: competicaoId ?? "" }), onError: (e) => fail("Erro ao atualizar pontuação", e) });
  const [pontuacaoDrafts, setPontuacaoDrafts] = useState<Record<string, string>>({});

  const submitCompeticao = () => createCompeticao.mutate({
    organizationId: activeOrgId,
    titulo: competicaoForm.titulo,
    descricao: competicaoForm.descricao || undefined,
    metrica: competicaoForm.metrica || undefined,
    dataInicio: competicaoForm.dataInicio,
    dataFim: competicaoForm.dataFim,
    paraTodos: competicaoForm.paraTodos,
  });

  const compElegiveis = selectedCompeticao?.para_todos ? students : students.filter((student) => compParticipanteIds.has(student.user_id));
  const compRanking = [...compElegiveis].sort((a, b) => (pontuacaoByAluno.get(b.user_id) ?? 0) - (pontuacaoByAluno.get(a.user_id) ?? 0));

  if (orgsQuery.isLoading) return <div className="p-8 text-sm text-[#918a7d]">Carregando organizações...</div>;
  if (!organizations.length) return <div className="mx-auto max-w-lg p-8 text-center text-sm text-[#918a7d]">Sua conta não está vinculada a nenhuma organização como profissional/gestão.</div>;

  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Desafios &amp; Competições</h2><p className="mt-1 text-sm text-[#77877d]">Engaje os alunos com o método Arke com desafios e rankings.</p></div>
      {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => { setOrganizationId(e.target.value); setDesafioId(null); setCompeticaoId(null); }} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
    </div>

    <div className="mb-4 flex gap-2"><Button variant={section === "desafios" ? "default" : "outline"} onClick={() => setSection("desafios")} className="h-9 rounded-xl text-xs">Desafios</Button><Button variant={section === "competicoes" ? "default" : "outline"} onClick={() => setSection("competicoes")} className="h-9 rounded-xl text-xs">Competições</Button></div>

    {section === "desafios" && <div className="grid gap-5 lg:grid-cols-[.7fr_1.3fr]">
      <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Desafios</CardTitle></CardHeader><CardContent className="space-y-1">
        {desafiosQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando...</p>}
        {!desafiosQuery.isLoading && desafios.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum desafio criado ainda.</p>}
        {desafios.map((desafio) => <button key={desafio.id} onClick={() => setDesafioId(desafio.id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${desafioId === desafio.id ? "bg-[#15130f] font-semibold text-white" : "text-[#4b4438] hover:bg-[#faf7ef]"}`}><span className="block truncate">{desafio.titulo}</span><span className={`block text-[10px] ${desafioId === desafio.id ? "text-white/70" : "text-[#9b9488]"}`}>{desafio.data_inicio} — {desafio.data_fim} · {desafio.pontos}pts</span></button>)}
        <div className="mt-3 space-y-2 rounded-xl bg-[#faf7ef] p-3">
          <p className="text-xs font-semibold text-[#4b4438]">Novo desafio</p>
          <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" />
          <textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Descrição (opcional)" className="min-h-14 w-full rounded-lg border bg-white p-2 text-xs" />
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as DesafioTipo })} className="h-9 w-full rounded-lg border bg-white px-2 text-xs">{TIPOS_DESAFIO.map((tipo) => <option key={tipo.value} value={tipo.value}>{tipo.label}</option>)}</select>
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.metaValor} onChange={(e) => setForm({ ...form, metaValor: e.target.value })} placeholder="Meta (opcional)" type="number" className="h-9 rounded-lg text-xs" />
            <Input value={form.pontos} onChange={(e) => setForm({ ...form, pontos: e.target.value })} placeholder="Pontos" type="number" className="h-9 rounded-lg text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.dataInicio} onChange={(e) => setForm({ ...form, dataInicio: e.target.value })} type="date" className="h-9 rounded-lg text-xs" />
            <Input value={form.dataFim} onChange={(e) => setForm({ ...form, dataFim: e.target.value })} type="date" className="h-9 rounded-lg text-xs" />
          </div>
          <label className="flex items-center gap-2 text-xs text-[#4b4438]"><input type="checkbox" checked={form.paraTodos} onChange={(e) => setForm({ ...form, paraTodos: e.target.checked })} className="h-4 w-4 accent-[#4c9a6a]" /> Para todos os alunos</label>
          <Button onClick={submitDesafio} disabled={!form.titulo || !form.dataInicio || !form.dataFim || createDesafio.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Criar desafio</Button>
        </div>
      </CardContent></Card>

      <div>
        {!selectedDesafio && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-8 text-center text-sm text-[#918a7d]">Selecione um desafio para gerenciar participantes e progresso.</CardContent></Card>}
        {selectedDesafio && <div className="space-y-4">
          <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">{selectedDesafio.titulo}</CardTitle></CardHeader><CardContent className="space-y-2">
            {selectedDesafio.descricao && <p className="text-xs text-[#5c5445]">{selectedDesafio.descricao}</p>}
            <p className="text-[10px] text-[#9b9488]">{TIPOS_DESAFIO.find((tipo) => tipo.value === selectedDesafio.tipo)?.label}{selectedDesafio.meta_valor != null ? ` · meta ${selectedDesafio.meta_valor}` : ""} · {selectedDesafio.pontos} pts · {selectedDesafio.para_todos ? "Para todos os alunos" : "Só para participantes selecionados"}</p>
            <Button variant="outline" onClick={() => { if (window.confirm("Remover este desafio?")) deleteDesafio.mutate({ id: selectedDesafio.id }); }} className="h-9 w-full rounded-lg text-xs text-[#b65c4d]"><Trash2 size={14} /> Remover desafio</Button>
          </CardContent></Card>

          {!selectedDesafio.para_todos && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Participantes</CardTitle></CardHeader><CardContent className="space-y-1.5">
            {students.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum aluno cadastrado nesta organização.</p>}
            {students.map((student) => <label key={student.user_id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs text-[#4b4438]"><span className="truncate">{student.full_name || "Aluno sem nome"}</span><input type="checkbox" checked={participanteIds.has(student.user_id)} onChange={(e) => e.target.checked ? addParticipante.mutate({ desafioId: selectedDesafio.id, alunoId: student.user_id }) : removeParticipante.mutate({ desafioId: selectedDesafio.id, alunoId: student.user_id })} className="h-4 w-4 accent-[#4c9a6a]" /></label>)}
          </CardContent></Card>}

          <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Progresso</CardTitle></CardHeader><CardContent className="space-y-1.5">
            {elegiveis.length === 0 && <p className="text-xs text-[#918a7d]">{selectedDesafio.para_todos ? "Nenhum aluno cadastrado nesta organização." : "Adicione participantes para registrar o progresso."}</p>}
            {elegiveis.map((student) => {
              const progresso = progressoByAluno.get(student.user_id);
              const isDone = progresso?.concluido ?? false;
              const valorDraft = valorDrafts[student.user_id] ?? (progresso?.valor_atual != null ? String(progresso.valor_atual) : "");
              return <div key={student.user_id} className="flex items-center justify-between gap-2 rounded-lg bg-[#faf7ef] px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-[#4b4438]">{student.full_name || "Aluno sem nome"}</span>
                {selectedDesafio.tipo !== "livre" && <Input value={valorDraft} onChange={(e) => setValorDrafts((prev) => ({ ...prev, [student.user_id]: e.target.value }))} placeholder="Valor" type="number" className="h-7 w-20 rounded-lg text-[10px]" />}
                <Button variant={isDone ? "default" : "outline"} onClick={() => setProgresso.mutate({ desafioId: selectedDesafio.id, alunoId: student.user_id, concluido: !isDone, valorAtual: valorDraft ? Number(valorDraft) : undefined })} disabled={setProgresso.isPending} className="h-7 shrink-0 rounded-lg text-[10px]"><CheckCircle2 size={12} /> {isDone ? "Concluído" : "Marcar"}</Button>
              </div>;
            })}
          </CardContent></Card>
        </div>}
      </div>
    </div>}

    {section === "competicoes" && <div className="grid gap-5 lg:grid-cols-[.7fr_1.3fr]">
      <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Competições</CardTitle></CardHeader><CardContent className="space-y-1">
        {competicoesQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando...</p>}
        {!competicoesQuery.isLoading && competicoes.length === 0 && <p className="text-xs text-[#918a7d]">Nenhuma competição criada ainda.</p>}
        {competicoes.map((competicao) => <button key={competicao.id} onClick={() => setCompeticaoId(competicao.id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${competicaoId === competicao.id ? "bg-[#15130f] font-semibold text-white" : "text-[#4b4438] hover:bg-[#faf7ef]"}`}><span className="block truncate">{competicao.titulo}</span><span className={`block text-[10px] ${competicaoId === competicao.id ? "text-white/70" : "text-[#9b9488]"}`}>{competicao.data_inicio} — {competicao.data_fim} · {competicao.metrica}</span></button>)}
        <div className="mt-3 space-y-2 rounded-xl bg-[#faf7ef] p-3">
          <p className="text-xs font-semibold text-[#4b4438]">Nova competição</p>
          <Input value={competicaoForm.titulo} onChange={(e) => setCompeticaoForm({ ...competicaoForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" />
          <textarea value={competicaoForm.descricao} onChange={(e) => setCompeticaoForm({ ...competicaoForm, descricao: e.target.value })} placeholder="Descrição (opcional)" className="min-h-14 w-full rounded-lg border bg-white p-2 text-xs" />
          <Input value={competicaoForm.metrica} onChange={(e) => setCompeticaoForm({ ...competicaoForm, metrica: e.target.value })} placeholder="O que está sendo medido (ex.: Quilômetros corridos)" className="h-9 rounded-lg text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={competicaoForm.dataInicio} onChange={(e) => setCompeticaoForm({ ...competicaoForm, dataInicio: e.target.value })} type="date" className="h-9 rounded-lg text-xs" />
            <Input value={competicaoForm.dataFim} onChange={(e) => setCompeticaoForm({ ...competicaoForm, dataFim: e.target.value })} type="date" className="h-9 rounded-lg text-xs" />
          </div>
          <label className="flex items-center gap-2 text-xs text-[#4b4438]"><input type="checkbox" checked={competicaoForm.paraTodos} onChange={(e) => setCompeticaoForm({ ...competicaoForm, paraTodos: e.target.checked })} className="h-4 w-4 accent-[#4c9a6a]" /> Para todos os alunos</label>
          <Button onClick={submitCompeticao} disabled={!competicaoForm.titulo || !competicaoForm.dataInicio || !competicaoForm.dataFim || createCompeticao.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Criar competição</Button>
        </div>
      </CardContent></Card>

      <div>
        {!selectedCompeticao && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-8 text-center text-sm text-[#918a7d]">Selecione uma competição para gerenciar participantes e o ranking.</CardContent></Card>}
        {selectedCompeticao && <div className="space-y-4">
          <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">{selectedCompeticao.titulo}</CardTitle></CardHeader><CardContent className="space-y-2">
            {selectedCompeticao.descricao && <p className="text-xs text-[#5c5445]">{selectedCompeticao.descricao}</p>}
            <p className="text-[10px] text-[#9b9488]">{selectedCompeticao.metrica} · {selectedCompeticao.para_todos ? "Para todos os alunos" : "Só para participantes selecionados"}</p>
            <Button variant="outline" onClick={() => { if (window.confirm("Remover esta competição?")) deleteCompeticao.mutate({ id: selectedCompeticao.id }); }} className="h-9 w-full rounded-lg text-xs text-[#b65c4d]"><Trash2 size={14} /> Remover competição</Button>
          </CardContent></Card>

          {!selectedCompeticao.para_todos && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Participantes</CardTitle></CardHeader><CardContent className="space-y-1.5">
            {students.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum aluno cadastrado nesta organização.</p>}
            {students.map((student) => <label key={student.user_id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs text-[#4b4438]"><span className="truncate">{student.full_name || "Aluno sem nome"}</span><input type="checkbox" checked={compParticipanteIds.has(student.user_id)} onChange={(e) => e.target.checked ? addCompParticipante.mutate({ competicaoId: selectedCompeticao.id, alunoId: student.user_id }) : removeCompParticipante.mutate({ competicaoId: selectedCompeticao.id, alunoId: student.user_id })} className="h-4 w-4 accent-[#4c9a6a]" /></label>)}
          </CardContent></Card>}

          <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Ranking ({selectedCompeticao.metrica})</CardTitle></CardHeader><CardContent className="space-y-1.5">
            {compRanking.length === 0 && <p className="text-xs text-[#918a7d]">{selectedCompeticao.para_todos ? "Nenhum aluno cadastrado nesta organização." : "Adicione participantes para registrar a pontuação."}</p>}
            {compRanking.map((student, index) => {
              const draft = pontuacaoDrafts[student.user_id] ?? String(pontuacaoByAluno.get(student.user_id) ?? "");
              return <div key={student.user_id} className="flex items-center gap-2 rounded-lg bg-[#faf7ef] px-3 py-2 text-xs">
                <span className="w-5 shrink-0 text-center font-semibold text-[#9b9488]">{index + 1}º</span>
                <span className="min-w-0 flex-1 truncate text-[#4b4438]">{student.full_name || "Aluno sem nome"}</span>
                <Input value={draft} onChange={(e) => setPontuacaoDrafts((prev) => ({ ...prev, [student.user_id]: e.target.value }))} placeholder="Valor" type="number" className="h-7 w-24 rounded-lg text-[10px]" />
                <Button variant="outline" onClick={() => setPontuacao.mutate({ competicaoId: selectedCompeticao.id, alunoId: student.user_id, valor: Number(draft || 0) })} disabled={setPontuacao.isPending} className="h-7 shrink-0 rounded-lg text-[10px]">Salvar</Button>
              </div>;
            })}
          </CardContent></Card>
        </div>}
      </div>
    </div>}
  </div>;
}

export default DesafiosAdmin;
