import { useMemo, useState } from "react";
import { ClipboardList, Download, Dumbbell, HeartHandshake, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

function downloadBase64Pdf(filename: string, contentBase64: string) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const CHECKIN_OPTIONS: Array<{ value: "indo_bem" | "com_dificuldade" | "quero_ajuda"; label: string }> = [
  { value: "indo_bem", label: "Indo bem" },
  { value: "com_dificuldade", label: "Com dificuldade" },
  { value: "quero_ajuda", label: "Quero ajuda" },
];

function CheckInWidget({ onToast }: { onToast: (title: string, detail: string) => void }) {
  const [status, setStatus] = useState<typeof CHECKIN_OPTIONS[number]["value"] | null>(null);
  const [observacao, setObservacao] = useState("");
  const atendimentosQuery = trpc.atendimento.meusAtendimentos.useQuery();
  const atendimentoAberto = (atendimentosQuery.data ?? []).find((item) => item.status !== "resolvida");
  const checkIn = trpc.atendimento.checkIn.useMutation({ onSuccess: () => { onToast("Check-in enviado", "Obrigado por compartilhar como você está."); setStatus(null); setObservacao(""); atendimentosQuery.refetch(); } });
  const pedirAjuda = trpc.atendimento.pedirAjuda.useMutation({ onSuccess: () => { onToast("Pedido enviado", "Sua equipe foi avisada e vai te procurar em breve."); atendimentosQuery.refetch(); } });

  return <Card className="mb-8 rounded-2xl border-[#e5ece5] bg-white shadow-sm">
    <CardHeader><CardTitle className="text-base text-[#2b271f]">Como você está?</CardTitle><p className="text-xs text-[#918a7d]">Um check-in rápido ajuda seu profissional a acompanhar sua adaptação.</p></CardHeader>
    <CardContent className="space-y-3">
      {atendimentoAberto && <div className="rounded-xl bg-[#faf3df] p-3 text-xs text-[#80641f]">Sua solicitação está sendo atendida pela equipe.</div>}
      <div className="flex flex-wrap gap-2">{CHECKIN_OPTIONS.map((option) => <Button key={option.value} variant={status === option.value ? "default" : "outline"} onClick={() => setStatus(option.value)} className="h-9 rounded-xl text-xs">{option.label}</Button>)}</div>
      {status && status !== "indo_bem" && <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Quer contar mais alguma coisa? (opcional)" className="min-h-16 w-full rounded-lg border border-[#e2dcca] bg-white p-2 text-xs" />}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => status && checkIn.mutate({ status, observacao: observacao || undefined })} disabled={!status || checkIn.isPending} className="h-9 rounded-xl bg-[#15130f] text-xs text-white">Enviar check-in</Button>
        <Button variant="outline" onClick={() => pedirAjuda.mutate({})} disabled={pedirAjuda.isPending} className="h-9 rounded-xl text-xs"><HeartHandshake size={14} /> Pedir ajuda agora</Button>
      </div>
    </CardContent>
  </Card>;
}

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

const HEALTH_DATA_FIELDS: Array<keyof typeof emptyAcolhimento> = ["dores_lesoes", "medicamentos"];

function AcolhimentoForm({ initial, onSaved }: { initial?: Partial<typeof emptyAcolhimento>; onSaved: () => void }) {
  const [form, setForm] = useState({ ...emptyAcolhimento, ...initial });
  const [healthConsent, setHealthConsent] = useState(false);
  const utils = trpc.useUtils();
  const consentStatusQuery = trpc.journey.getConsentStatus.useQuery();
  const submit = trpc.journey.submitAcolhimento.useMutation({ onSuccess: () => { utils.journey.getConsentStatus.invalidate(); onSaved(); } });

  const touchesHealthData = HEALTH_DATA_FIELDS.some((field) => form[field].trim().length > 0);
  const needsHealthConsent = touchesHealthData && (consentStatusQuery.data ? !consentStatusQuery.data.dadosSaude : true);

  const submitForm = () => {
    const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim().length > 0));
    submit.mutate(needsHealthConsent ? { ...payload, consentDadosSaude: true } : payload);
  };

  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm">
    <CardHeader><CardTitle className="text-base text-[#2b271f]">Vamos te conhecer melhor</CardTitle><p className="text-xs text-[#918a7d]">Essas respostas ajudam seu profissional a montar um plano sob medida para você.</p></CardHeader>
    <CardContent className="space-y-4">
      {ACOLHIMENTO_QUESTIONS.map(([question, field]) => <div key={field}>
        <label className="mb-1 block text-xs font-semibold text-[#4b4438]">{question}</label>
        <textarea value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} className="min-h-16 w-full rounded-lg border border-[#e2dcca] bg-white p-2 text-xs" />
        {field === "medicamentos" && needsHealthConsent && <label className="mt-2 flex items-start gap-2 text-xs text-[#766f62]"><input type="checkbox" checked={healthConsent} onChange={(e) => setHealthConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#4c9a6a]" /> Autorizo o uso destas informações de saúde (dores, lesões e medicamentos) pela equipe responsável pelo meu acompanhamento, conforme a Política de Privacidade.</label>}
      </div>)}
      {submit.error && <p className="rounded-xl bg-[#f8e6df] px-3 py-2 text-xs text-[#b65343]">{submit.error.message}</p>}
      <Button onClick={submitForm} disabled={submit.isPending || (needsHealthConsent && !healthConsent)} className="h-11 w-full rounded-xl bg-[#15130f] text-sm font-semibold text-white">Enviar respostas</Button>
    </CardContent>
  </Card>;
}

function TreinoCard({ treino }: { treino: { id: string; titulo: string; tipo: string; descricao?: string | null; versao: number } }) {
  const exerciciosQuery = trpc.prescricao.meu.treinoExercicios.useQuery({ treinoId: treino.id });
  const exercicios = exerciciosQuery.data ?? [];
  const exercisesQuery = trpc.prescricao.exercises.useQuery();
  const exercises = exercisesQuery.data ?? [];
  const utils = trpc.useUtils();
  const [downloading, setDownloading] = useState(false);
  const downloadFicha = async () => {
    setDownloading(true);
    try {
      const ficha = await utils.prescricao.meu.fichaPdf.fetch({ treinoId: treino.id });
      downloadBase64Pdf(ficha.filename, ficha.contentBase64);
    } finally {
      setDownloading(false);
    }
  };
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">{treino.titulo} · {treino.tipo}</CardTitle><p className="text-xs text-[#918a7d]">Versão {treino.versao}</p></CardHeader><CardContent>
    {treino.descricao && <p className="mb-3 text-sm text-[#5c5445]">{treino.descricao}</p>}
    {exerciciosQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando exercícios...</p>}
    {!exerciciosQuery.isLoading && exercicios.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum exercício cadastrado neste treino ainda.</p>}
    <div className="space-y-2">{exercicios.map((item) => { const exercicio = exercises.find((ex) => ex.id === item.exercicio_id); return <div key={item.id} className="rounded-xl border border-[#eee9df] p-3"><p className="text-sm font-semibold text-[#4b4438]">{exercicio?.nome ?? "Exercício"}</p><p className="mt-1 text-xs text-[#9b9488]">{item.series} séries x {item.repeticoes} repetições · descanso {item.descanso_seg}s{item.observacoes ? ` · ${item.observacoes}` : ""}</p></div>; })}</div>
    <Button variant="outline" onClick={downloadFicha} disabled={downloading} className="mt-3 h-9 w-full rounded-xl text-xs"><Download size={14} /> Baixar ficha (impressora térmica)</Button>
  </CardContent></Card>;
}

function MinhaPrivacidadeCard() {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const requestQuery = trpc.journey.myDeletionRequest.useQuery();
  const requestDeletion = trpc.journey.requestAccountDeletion.useMutation({ onSuccess: () => { utils.journey.myDeletionRequest.invalidate(); setReason(""); setConfirming(false); } });
  const pending = requestQuery.data?.status === "pending";

  return <Card className="mt-8 rounded-2xl border-[#e5ece5] bg-white shadow-sm">
    <CardHeader><CardTitle className="text-base text-[#2b271f]">Privacidade e meus dados</CardTitle><p className="text-xs text-[#918a7d]">Você pode solicitar a exclusão dos seus dados pessoais a qualquer momento.</p></CardHeader>
    <CardContent className="space-y-3">
      {requestQuery.data?.status === "pending" && <div className="rounded-xl bg-[#faf3df] p-3 text-xs text-[#80641f]">Sua solicitação de exclusão está pendente de aprovação pela equipe.</div>}
      {requestQuery.data?.status === "completed" && <div className="rounded-xl bg-[#eef4ee] p-3 text-xs text-[#3e8254]">Sua solicitação de exclusão foi concluída.</div>}
      {requestQuery.data?.status === "rejected" && <div className="rounded-xl bg-[#f8e6df] p-3 text-xs text-[#b65343]">Sua solicitação de exclusão foi recusada{requestQuery.data.resolution_note ? `: ${requestQuery.data.resolution_note}` : "."}</div>}
      {!pending && <>
        {!confirming && <Button variant="outline" onClick={() => setConfirming(true)} className="h-9 rounded-xl text-xs text-[#b65343]">Solicitar exclusão da minha conta</Button>}
        {confirming && <div className="space-y-2 rounded-xl bg-[#faf7ef] p-3">
          <p className="text-xs leading-5 text-[#766f62]">Isso vai apagar seu cadastro, treinos, planos alimentares, check-ins e acolhimento depois que sua academia aprovar o pedido. Essa ação não pode ser desfeita.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" className="min-h-16 w-full rounded-lg border border-[#e2dcca] bg-white p-2 text-xs" />
          {requestDeletion.error && <p className="rounded-xl bg-[#f8e6df] px-3 py-2 text-xs text-[#b65343]">{requestDeletion.error.message}</p>}
          <div className="flex gap-2">
            <Button onClick={() => requestDeletion.mutate({ reason: reason || undefined })} disabled={requestDeletion.isPending} className="h-9 rounded-xl bg-[#b65343] text-xs text-white">Confirmar solicitação</Button>
            <Button variant="outline" onClick={() => setConfirming(false)} className="h-9 rounded-xl text-xs">Cancelar</Button>
          </div>
        </div>}
      </>}
    </CardContent>
  </Card>;
}

export function StudentDashboard() {
  const [toast, setToast] = useState<{ title: string; detail: string } | null>(null);
  const onToast = (title: string, detail: string) => { setToast({ title, detail }); window.setTimeout(() => setToast(null), 3800); };
  const treinosQuery = trpc.prescricao.meu.treinos.useQuery();
  const dietasQuery = trpc.prescricao.meu.dietas.useQuery();
  const treinos = useMemo(() => treinosQuery.data ?? [], [treinosQuery.data]);
  const dietas = useMemo(() => dietasQuery.data ?? [], [dietasQuery.data]);
  const acolhimentoQuery = trpc.journey.myAcolhimento.useQuery();
  const [editingAcolhimento, setEditingAcolhimento] = useState(false);

  return <div className="mx-auto max-w-[1100px] p-5 sm:p-8">
    <div className="mb-6"><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Meu treino</h2><p className="mt-1 text-sm text-[#77877d]">Seu treino e plano alimentar publicados pelo seu profissional.</p></div>

    {toast && <div className="mb-6 rounded-xl bg-[#eef4ee] px-4 py-3 text-sm text-[#3e8254]"><strong>{toast.title}</strong> — {toast.detail}</div>}

    <CheckInWidget onToast={onToast} />

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

    <MinhaPrivacidadeCard />
  </div>;
}

export default StudentDashboard;
