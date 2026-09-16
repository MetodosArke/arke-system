import { useEffect, useState } from "react";
import { CalendarClock, Sparkles } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const DEDICACAO_OPTIONS: Array<{ value: "baixa" | "media" | "boa" | "excelente"; label: string }> = [
  { value: "baixa", label: "😞 Baixa" },
  { value: "media", label: "😐 Média" },
  { value: "boa", label: "🙂 Boa" },
  { value: "excelente", label: "🤩 Excelente" },
];

const DIAS_SEMANA = [
  { value: "segunda", label: "Seg" },
  { value: "terca", label: "Ter" },
  { value: "quarta", label: "Qua" },
  { value: "quinta", label: "Qui" },
  { value: "sexta", label: "Sex" },
  { value: "sabado", label: "Sáb" },
  { value: "domingo", label: "Dom" },
];

function CheckinDiarioCard() {
  const utils = trpc.useUtils();
  const checkinQuery = trpc.arke.meu.checkinHoje.useQuery();
  const registrar = trpc.arke.meu.registrarCheckin.useMutation({ onSuccess: () => utils.arke.meu.checkinHoje.invalidate() });
  if (checkinQuery.isLoading) return null;
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Check-in de hoje</CardTitle><p className="text-xs text-[#918a7d]">Como está sua dedicação hoje?</p></CardHeader><CardContent>
    {checkinQuery.data ? <p className="text-sm text-[#5c5445]">Você já registrou sua dedicação de hoje. Até amanhã!</p> : <div className="flex flex-wrap gap-2">{DEDICACAO_OPTIONS.map((option) => <Button key={option.value} variant="outline" onClick={() => registrar.mutate({ dedicacao: option.value })} disabled={registrar.isPending} className="h-9 rounded-xl text-xs">{option.label}</Button>)}</div>}
  </CardContent></Card>;
}

function AvaliacaoSemanalCard() {
  const utils = trpc.useUtils();
  const avaliacaoQuery = trpc.arke.meu.avaliacaoSemanaAtual.useQuery();
  const [form, setForm] = useState({ sono: 5, produtividade: 5, humor: 5, conquista: "" });
  const [editing, setEditing] = useState(false);
  const registrar = trpc.arke.meu.registrarAvaliacaoSemanal.useMutation({ onSuccess: () => { utils.arke.meu.avaliacaoSemanaAtual.invalidate(); setEditing(false); } });
  const avaliacao = avaliacaoQuery.data;
  const beginEdit = () => { if (avaliacao) setForm({ sono: avaliacao.sono, produtividade: avaliacao.produtividade, humor: avaliacao.humor, conquista: avaliacao.conquista ?? "" }); setEditing(true); };
  if (avaliacaoQuery.isLoading) return null;
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Avaliação da semana</CardTitle></CardHeader><CardContent className="space-y-3">
    {avaliacao && !editing ? <>
      <p className="text-sm text-[#5c5445]">Sono {avaliacao.sono}/10 · Produtividade {avaliacao.produtividade}/10 · Humor {avaliacao.humor}/10</p>
      {avaliacao.conquista && <p className="text-xs text-[#918a7d]">"{avaliacao.conquista}"</p>}
      <Button variant="outline" onClick={beginEdit} className="h-9 rounded-xl text-xs">Editar</Button>
    </> : <>
      {(["sono", "produtividade", "humor"] as const).map((campo) => <div key={campo}><label className="mb-1 flex items-center justify-between text-xs font-semibold capitalize text-[#4b4438]"><span>{campo}</span><span>{form[campo]}/10</span></label><input type="range" min={1} max={10} value={form[campo]} onChange={(e) => setForm({ ...form, [campo]: Number(e.target.value) })} className="w-full" /></div>)}
      <textarea value={form.conquista} onChange={(e) => setForm({ ...form, conquista: e.target.value })} placeholder="Alguma conquista da semana? (opcional)" className="min-h-16 w-full rounded-lg border border-[#e2dcca] bg-white p-2 text-xs" />
      <Button onClick={() => registrar.mutate({ sono: form.sono, produtividade: form.produtividade, humor: form.humor, conquista: form.conquista || undefined })} disabled={registrar.isPending} className="h-9 w-full rounded-xl bg-[#15130f] text-xs text-white">Salvar avaliação</Button>
    </>}
  </CardContent></Card>;
}

function PlanoTreinoSemanalCard() {
  const utils = trpc.useUtils();
  const planoQuery = trpc.arke.meu.planoTreinoSemanal.useQuery();
  const salvar = trpc.arke.meu.salvarPlanoTreinoSemanal.useMutation({ onSuccess: () => { utils.arke.meu.planoTreinoSemanal.invalidate(); } });
  const [dias, setDias] = useState<string[]>([]);
  const [horario, setHorario] = useState("");
  const [local, setLocal] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (planoQuery.data && !hydrated) {
      setDias(planoQuery.data.dias_treino ?? []);
      setHorario(planoQuery.data.horario_preferido ?? "");
      setLocal(planoQuery.data.local_treino ?? "");
      setHydrated(true);
    }
  }, [planoQuery.data, hydrated]);
  const toggleDia = (value: string) => setDias((current) => current.includes(value) ? current.filter((d) => d !== value) : [...current, value]);
  if (planoQuery.isLoading) return null;
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Planejamento de horários</CardTitle><p className="text-xs text-[#918a7d]">Em quais dias e horários você pretende treinar?</p></CardHeader><CardContent className="space-y-3">
    <div className="flex flex-wrap gap-2">{DIAS_SEMANA.map((dia) => <Button key={dia.value} type="button" variant={dias.includes(dia.value) ? "default" : "outline"} onClick={() => toggleDia(dia.value)} className="h-8 rounded-lg text-[11px]">{dia.label}</Button>)}</div>
    <Input value={horario} onChange={(e) => setHorario(e.target.value)} placeholder="Horário preferido (ex.: 7h ou 19h)" className="h-9 rounded-lg text-xs" />
    <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Local de treino" className="h-9 rounded-lg text-xs" />
    <Button onClick={() => salvar.mutate({ diasTreino: dias, horarioPreferido: horario || undefined, localTreino: local || undefined })} disabled={salvar.isPending} className="h-9 w-full rounded-xl bg-[#15130f] text-xs text-white">Salvar planejamento</Button>
  </CardContent></Card>;
}

function EvolucaoCard() {
  const progressoQuery = trpc.arke.meu.progresso.useQuery();
  const historico = progressoQuery.data ?? [];
  if (progressoQuery.isLoading) return null;
  const chartData = historico.filter((registro) => registro.peso_kg != null).map((registro) => ({ data: registro.data, peso: registro.peso_kg }));
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm sm:col-span-2"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Evolução</CardTitle><p className="text-xs text-[#918a7d]">Medidas registradas pelo seu profissional.</p></CardHeader><CardContent>
    {historico.length === 0 && <p className="text-sm text-[#5c5445]">Nenhuma medida registrada ainda. Fale com seu profissional na próxima avaliação.</p>}
    {chartData.length >= 2 && <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={chartData}>
        <defs><linearGradient id="evolucaoPesoGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a47b13" stopOpacity={0.4} /><stop offset="100%" stopColor="#a47b13" stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee9df" vertical={false} />
        <XAxis dataKey="data" tick={{ fontSize: 10, fill: "#9b9488" }} tickFormatter={(value: string) => value.slice(5)} />
        <YAxis tick={{ fontSize: 10, fill: "#9b9488" }} width={32} domain={["auto", "auto"]} />
        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
        <Area type="monotone" dataKey="peso" name="Peso (kg)" stroke="#a47b13" fill="url(#evolucaoPesoGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>}
    {historico.length > 0 && <div className="mt-3 space-y-1.5">
      {[...historico].reverse().slice(0, 5).map((registro) => <div key={registro.id} className="flex items-center justify-between rounded-lg bg-[#faf7ef] px-3 py-2 text-xs text-[#5c5445]">
        <span>{new Date(`${registro.data}T00:00:00`).toLocaleDateString("pt-BR")}</span>
        <span className="text-[#4b4438]">{[registro.peso_kg != null ? `${registro.peso_kg}kg` : null, registro.gordura_percentual != null ? `${registro.gordura_percentual}% gordura` : null].filter(Boolean).join(" · ") || "—"}</span>
      </div>)}
    </div>}
  </CardContent></Card>;
}

export function AlunoArke() {
  const temArkeQuery = trpc.arke.meu.temArke.useQuery();
  if (temArkeQuery.isLoading) return null;
  if (!temArkeQuery.data) return <Card className="mb-8 rounded-2xl border border-dashed border-[#dfd8c8] bg-[#fffdf9] shadow-sm"><CardContent className="flex items-center gap-3 p-5"><Sparkles size={18} className="shrink-0 text-[#a47b13]" /><p className="text-sm text-[#77877d]">O método Arke traz check-in diário, avaliação semanal, planejamento de horários e muito mais. Fale com seu profissional para ativar.</p></CardContent></Card>;
  return <div className="mb-8 space-y-3">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><CalendarClock size={14} /> Método Arke</div>
    <div className="grid gap-4 sm:grid-cols-2">
      <CheckinDiarioCard />
      <AvaliacaoSemanalCard />
      <PlanoTreinoSemanalCard />
      <EvolucaoCard />
    </div>
  </div>;
}

export default AlunoArke;
