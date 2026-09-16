import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, Heart, ImageIcon, MessageCircle, Rss, Send, Sparkles, Star, Trash2, Trophy, X } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { readFileAsBase64 } from "@/lib/upload";

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
  const [horasSono, setHorasSono] = useState("");
  const registrar = trpc.arke.meu.registrarCheckin.useMutation({ onSuccess: () => utils.arke.meu.checkinHoje.invalidate() });
  if (checkinQuery.isLoading) return null;
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Check-in de hoje</CardTitle><p className="text-xs text-[#918a7d]">Como está sua dedicação hoje?</p></CardHeader><CardContent>
    {checkinQuery.data ? <p className="text-sm text-[#5c5445]">Você já registrou sua dedicação de hoje{checkinQuery.data.horas_sono != null ? ` (${checkinQuery.data.horas_sono}h de sono)` : ""}. Até amanhã!</p> : <div className="space-y-2">
      <Input value={horasSono} onChange={(e) => setHorasSono(e.target.value)} type="number" min={0} max={24} step={0.5} placeholder="Horas de sono (opcional)" className="h-9 rounded-lg text-xs" />
      <div className="flex flex-wrap gap-2">{DEDICACAO_OPTIONS.map((option) => <Button key={option.value} variant="outline" onClick={() => registrar.mutate({ dedicacao: option.value, horasSono: horasSono ? Number(horasSono) : undefined })} disabled={registrar.isPending} className="h-9 rounded-xl text-xs">{option.label}</Button>)}</div>
    </div>}
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

function TreinoDiaCard() {
  const utils = trpc.useUtils();
  const today = new Date().toISOString().slice(0, 10);
  const treinosQuery = trpc.arke.meu.treinosPeriodo.useQuery({ desde: today, ate: today });
  const [tipos, setTipos] = useState("");
  const [duracaoMin, setDuracaoMin] = useState("");
  const [distanciaKm, setDistanciaKm] = useState("");
  const registrar = trpc.arke.meu.registrarTreinoDia.useMutation({ onSuccess: () => { setTipos(""); setDuracaoMin(""); setDistanciaKm(""); utils.arke.meu.treinosPeriodo.invalidate(); } });
  if (treinosQuery.isLoading) return null;
  const registrosHoje = treinosQuery.data ?? [];
  const submit = () => {
    const tiposArray = tipos.split(",").map((tipo) => tipo.trim()).filter(Boolean);
    if (!tiposArray.length) return;
    registrar.mutate({ data: today, tipos: tiposArray, duracaoMin: duracaoMin ? Number(duracaoMin) : undefined, distanciaKm: distanciaKm ? Number(distanciaKm) : undefined });
  };
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Treino de hoje</CardTitle><p className="text-xs text-[#918a7d]">Registre o que você treinou hoje.</p></CardHeader><CardContent className="space-y-2">
    {registrosHoje.length > 0 && <div className="space-y-1">{registrosHoje.map((registro) => <p key={registro.id} className="text-xs text-[#5c5445]">✓ {registro.tipos.join(", ")}{registro.duracao_min ? ` · ${registro.duracao_min}min` : ""}{registro.distancia_km ? ` · ${registro.distancia_km}km` : ""}</p>)}</div>}
    <Input value={tipos} onChange={(e) => setTipos(e.target.value)} placeholder="Modalidades (ex.: Musculação, Corrida)" className="h-9 rounded-lg text-xs" />
    <div className="grid grid-cols-2 gap-2">
      <Input value={duracaoMin} onChange={(e) => setDuracaoMin(e.target.value)} type="number" min={1} placeholder="Duração (min)" className="h-9 rounded-lg text-xs" />
      <Input value={distanciaKm} onChange={(e) => setDistanciaKm(e.target.value)} type="number" min={0} step={0.1} placeholder="Km (opcional)" className="h-9 rounded-lg text-xs" />
    </div>
    <Button onClick={submit} disabled={registrar.isPending || !tipos.trim()} className="h-9 w-full rounded-xl bg-[#15130f] text-xs text-white">Registrar treino</Button>
  </CardContent></Card>;
}

function DietaAdesaoCard() {
  const utils = trpc.useUtils();
  const dietaAtivaQuery = trpc.arke.meu.dietaAtiva.useQuery();
  const adesaoHojeQuery = trpc.arke.meu.dietaAdesaoHoje.useQuery(undefined, { enabled: Boolean(dietaAtivaQuery.data) });
  const [adesao, setAdesao] = useState(80);
  const [consumiuDoce, setConsumiuDoce] = useState(false);
  const [consumiuAlcool, setConsumiuAlcool] = useState(false);
  const [aguaMl, setAguaMl] = useState("");
  const registrar = trpc.arke.meu.registrarDietaAdesao.useMutation({ onSuccess: () => utils.arke.meu.dietaAdesaoHoje.invalidate() });
  if (dietaAtivaQuery.isLoading || (dietaAtivaQuery.data && adesaoHojeQuery.isLoading)) return null;
  if (!dietaAtivaQuery.data) return null;
  const adesaoHoje = adesaoHojeQuery.data;
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Dieta de hoje</CardTitle></CardHeader><CardContent className="space-y-2">
    {adesaoHoje ? <p className="text-sm text-[#5c5445]">Adesão de hoje registrada: {adesaoHoje.adesao_percentual}%{adesaoHoje.agua_ml ? ` · ${adesaoHoje.agua_ml}ml de água` : ""}.</p> : <>
      <label className="flex items-center justify-between text-xs font-semibold text-[#4b4438]"><span>Adesão à dieta</span><span>{adesao}%</span></label>
      <input type="range" min={0} max={100} value={adesao} onChange={(e) => setAdesao(Number(e.target.value))} className="w-full" />
      <div className="flex gap-4 text-xs text-[#5c5445]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={consumiuDoce} onChange={(e) => setConsumiuDoce(e.target.checked)} /> Comi doce</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={consumiuAlcool} onChange={(e) => setConsumiuAlcool(e.target.checked)} /> Bebi álcool</label>
      </div>
      <Input value={aguaMl} onChange={(e) => setAguaMl(e.target.value)} type="number" min={0} placeholder="Água (ml, opcional)" className="h-9 rounded-lg text-xs" />
      <Button onClick={() => registrar.mutate({ adesaoPercentual: adesao, consumiuDoce, consumiuAlcool, aguaMl: aguaMl ? Number(aguaMl) : undefined })} disabled={registrar.isPending} className="h-9 w-full rounded-xl bg-[#15130f] text-xs text-white">Registrar dieta de hoje</Button>
    </>}
  </CardContent></Card>;
}

function CompromissoSemanalCard() {
  const utils = trpc.useUtils();
  const compromissoQuery = trpc.arke.meu.compromissoSemanaAtual.useQuery();
  const [novaMeta, setNovaMeta] = useState("");
  const invalidate = () => utils.arke.meu.compromissoSemanaAtual.invalidate();
  const criar = trpc.arke.meu.criarMetaSemana.useMutation({ onSuccess: () => { setNovaMeta(""); invalidate(); } });
  const marcar = trpc.arke.meu.marcarMetaConcluida.useMutation({ onSuccess: invalidate });
  if (compromissoQuery.isLoading) return null;
  const metas = compromissoQuery.data?.metas ?? [];
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Micrometas da semana</CardTitle><p className="text-xs text-[#918a7d]">O que você se compromete a fazer esta semana?</p></CardHeader><CardContent className="space-y-2">
    {metas.length > 0 && <div className="space-y-1.5">{metas.map((meta) => <label key={meta.id} className="flex items-center gap-2 rounded-lg bg-[#faf7ef] px-3 py-2 text-xs"><input type="checkbox" checked={meta.concluida} onChange={(e) => marcar.mutate({ metaId: meta.id, concluida: e.target.checked })} /><span className={meta.concluida ? "text-[#9b9488] line-through" : "text-[#4b4438]"}>{meta.texto}</span></label>)}</div>}
    <div className="flex gap-2"><Input value={novaMeta} onChange={(e) => setNovaMeta(e.target.value)} placeholder="Nova meta (ex.: treinar 4x)" className="h-9 rounded-lg text-xs" onKeyDown={(e) => { if (e.key === "Enter" && novaMeta.trim()) criar.mutate({ texto: novaMeta.trim() }); }} /><Button onClick={() => novaMeta.trim() && criar.mutate({ texto: novaMeta.trim() })} disabled={criar.isPending || !novaMeta.trim()} className="h-9 shrink-0 rounded-lg bg-[#15130f] text-xs text-white">Adicionar</Button></div>
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

const ORIGEM_PONTO_LABEL: Record<string, string> = { engajamento: "Engajamento", meta: "Meta atingida", desafio: "Desafio" };

function PontuacaoCard() {
  const { desde, ate } = useMemo(() => {
    const hoje = new Date();
    const trintaDiasAtras = new Date(hoje.getTime() - 1000 * 60 * 60 * 24 * 30);
    return { desde: trintaDiasAtras.toISOString().slice(0, 10), ate: hoje.toISOString().slice(0, 10) };
  }, []);
  const pontuacaoQuery = trpc.arke.meu.minhaPontuacao.useQuery({ desde, ate });
  const comparativoQuery = trpc.arke.meu.comparativo.useQuery({ desde, ate });
  if (pontuacaoQuery.isLoading) return null;
  const dados = pontuacaoQuery.data;
  const comparativo = comparativoQuery.data;
  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm text-[#2b271f]"><Star size={15} className="text-[#a47b13]" /> Sua pontuação (últimos 30 dias)</CardTitle></CardHeader><CardContent>
    <p className="text-2xl font-semibold tracking-[-.05em] text-[#2b271f]">{dados?.total ?? 0} pts</p>
    {comparativo && comparativo.tamanhoGrupo > 1 && <p className="mt-1 text-xs text-[#918a7d]">Média da turma ({comparativo.tamanhoGrupo} alunos): {comparativo.mediaGrupo.toFixed(1)} pts</p>}
    {dados && dados.eventos.length > 0 ? <div className="mt-3 space-y-1.5">{[...dados.eventos].reverse().slice(0, 8).map((evento, index) => <div key={index} className="flex items-center justify-between rounded-lg bg-[#faf7ef] px-3 py-1.5 text-xs"><div className="min-w-0"><span className="text-[#4b4438]">{evento.descricao}</span><span className="ml-1.5 text-[10px] text-[#9b9488]">{ORIGEM_PONTO_LABEL[evento.origem]}</span></div><span className="shrink-0 font-semibold text-[#a47b13]">+{evento.pontos}</span></div>)}</div> : <p className="mt-2 text-xs text-[#918a7d]">Preencha check-ins, avaliações e treinos para somar pontos.</p>}
  </CardContent></Card>;
}

const TIPO_DESAFIO_LABEL: Record<string, string> = {
  livre: "Desafio livre",
  sem_doce: "Sem doce",
  sem_alcool: "Sem álcool",
  consumo_agua: "Consumo de água",
  numero_treinos: "Número de treinos",
  quilometros: "Quilômetros",
  modalidades: "Modalidades",
  desempenho_dieta: "Desempenho na dieta",
};

function DesafiosSection() {
  const desafiosQuery = trpc.arke.desafios.meus.useQuery();
  if (desafiosQuery.isLoading) return null;
  const desafios = desafiosQuery.data ?? [];
  const now = new Date();
  const ativos = desafios.filter((desafio) => new Date(desafio.dataFim) >= now);
  const encerrados = desafios.filter((desafio) => new Date(desafio.dataFim) < now);

  const renderDesafio = (desafio: (typeof desafios)[number]) => {
    const percent = desafio.metaValor && desafio.metaValor > 0 && desafio.valorAtual != null ? Math.min(100, Math.round((desafio.valorAtual / desafio.metaValor) * 100)) : desafio.concluido ? 100 : 0;
    return <div key={desafio.id} className="rounded-xl border border-[#eee9df] bg-[#faf7ef] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="truncate text-xs font-semibold text-[#2b271f]">{desafio.titulo}</p><p className="text-[10px] text-[#9b9488]">{TIPO_DESAFIO_LABEL[desafio.tipo] ?? desafio.tipo} · {desafio.pontos} pts</p></div>
        {desafio.concluido && <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#e4f2e8] px-2 py-0.5 text-[10px] font-semibold text-[#3e8254]"><CheckCircle2 size={11} /> Concluído</span>}
      </div>
      {desafio.descricao && <p className="mt-1.5 text-xs text-[#5c5445]">{desafio.descricao}</p>}
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between text-[10px] text-[#9b9488]"><span>{desafio.dataInicio} — {desafio.dataFim}</span>{desafio.metaValor != null && desafio.valorAtual != null && <span>{desafio.valorAtual} / {desafio.metaValor}</span>}</div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#eee9df]"><div className="h-full rounded-full bg-[#a47b13]" style={{ width: `${percent}%` }} /></div>
      </div>
    </div>;
  };

  return <div className="space-y-3">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><Trophy size={14} /> Desafios</div>
    {desafios.length === 0 && <p className="text-sm text-[#5c5445]">Nenhum desafio disponível no momento.</p>}
    {ativos.length > 0 && <div className="space-y-2">{ativos.map(renderDesafio)}</div>}
    {encerrados.length > 0 && <div className="space-y-2 opacity-70">{encerrados.map(renderDesafio)}</div>}
  </div>;
}

function CompeticoesSection() {
  const meQuery = trpc.auth.me.useQuery();
  const competicoesQuery = trpc.arke.competicoes.meus.useQuery();
  if (competicoesQuery.isLoading) return null;
  const competicoes = competicoesQuery.data ?? [];
  if (competicoes.length === 0) return null;
  const myUserId = meQuery.data?.id;

  return <div className="space-y-3">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><Trophy size={14} /> Competições</div>
    {competicoes.map((competicao) => <Card key={competicao.id} className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">{competicao.titulo}</CardTitle><p className="text-xs text-[#918a7d]">{competicao.metrica} · {competicao.dataInicio} — {competicao.dataFim}</p></CardHeader><CardContent className="space-y-1.5">
      {competicao.descricao && <p className="mb-2 text-xs text-[#5c5445]">{competicao.descricao}</p>}
      {competicao.ranking.slice(0, 10).map((entry) => <div key={entry.alunoId} className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs ${entry.alunoId === myUserId ? "bg-[#f5ead0] font-semibold text-[#4b4438]" : "bg-[#faf7ef] text-[#5c5445]"}`}>
        <span className="w-5 shrink-0 text-center font-semibold text-[#a47b13]">{entry.posicao}º</span>
        <span className="min-w-0 flex-1 truncate">{entry.nome}{entry.alunoId === myUserId ? " (você)" : ""}</span>
        <span className="shrink-0 font-semibold text-[#4b4438]">{entry.valor}</span>
      </div>)}
      {competicao.ranking.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum participante ainda.</p>}
    </CardContent></Card>)}
  </div>;
}

function FeedSection() {
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery();
  const feedQuery = trpc.arke.feed.list.useQuery();
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const invalidateFeed = () => utils.arke.feed.list.invalidate();
  const uploadImage = trpc.arke.feed.uploadImage.useMutation();
  const createPost = trpc.arke.feed.create.useMutation({ onSuccess: () => { setContent(""); setImageFile(null); setImagePreview(null); invalidateFeed(); } });
  const deletePost = trpc.arke.feed.delete.useMutation({ onSuccess: invalidateFeed });
  const toggleLike = trpc.arke.feed.toggleLike.useMutation({ onSuccess: invalidateFeed });
  const addComment = trpc.arke.feed.comments.create.useMutation({ onSuccess: (_, variables) => { setCommentDrafts((prev) => ({ ...prev, [variables.postId]: "" })); invalidateFeed(); } });
  const deleteComment = trpc.arke.feed.comments.delete.useMutation({ onSuccess: invalidateFeed });

  const handleImageSelect = (file?: File) => {
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const submitPost = async () => {
    if (!content.trim() && !imageFile) return;
    setPosting(true);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        const { base64, contentType } = await readFileAsBase64(imageFile);
        const { url } = await uploadImage.mutateAsync({ contentType, dataBase64: base64 });
        imageUrl = url;
      }
      await createPost.mutateAsync({ content, imageUrl });
    } finally {
      setPosting(false);
    }
  };

  if (feedQuery.isLoading) return null;
  const posts = feedQuery.data ?? [];
  const myUserId = meQuery.data?.id;

  return <div className="space-y-3">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#a47b13]"><Rss size={14} /> Feed da comunidade</div>
    <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="space-y-2 p-4">
      <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="O que você está pensando?" className="min-h-16 w-full rounded-lg border border-[#e2dcca] bg-white p-2 text-xs" />
      {imagePreview && <div className="relative inline-block"><img src={imagePreview} alt="" className="max-h-32 rounded-lg" /><button onClick={() => { setImageFile(null); setImagePreview(null); }} className="absolute -right-2 -top-2 rounded-full bg-[#b65c4d] p-1 text-white"><X size={11} /></button></div>}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => fileRef.current?.click()} className="h-8 rounded-lg text-xs"><ImageIcon size={14} /> Foto</Button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageSelect(e.target.files?.[0])} />
        <Button onClick={submitPost} disabled={posting || (!content.trim() && !imageFile)} className="h-8 rounded-lg bg-[#15130f] text-xs text-white"><Send size={14} /> Publicar</Button>
      </div>
    </CardContent></Card>
    {posts.length === 0 && <p className="text-sm text-[#5c5445]">Nenhuma publicação ainda. Seja o primeiro!</p>}
    {posts.map((post) => <Card key={post.id} className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-xs font-semibold text-[#2b271f]">{post.authorName}</p><p className="text-[10px] text-[#9b9488]">{new Date(post.createdAt).toLocaleString("pt-BR")}</p></div>
        {post.userId === myUserId && <Button variant="ghost" onClick={() => { if (window.confirm("Remover esta publicação?")) deletePost.mutate({ id: post.id }); }} className="h-7 w-7 shrink-0 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button>}
      </div>
      {post.content && <p className="whitespace-pre-wrap text-sm text-[#4b4438]">{post.content}</p>}
      {post.imageUrl && <img src={post.imageUrl} alt="" className="max-h-80 w-full rounded-lg object-cover" />}
      <div className="flex items-center gap-4 border-t border-[#eee9df] pt-2">
        <button onClick={() => toggleLike.mutate({ postId: post.id })} className={`flex items-center gap-1.5 text-xs ${post.likedByMe ? "text-[#a47b13]" : "text-[#918a7d]"}`}><Heart size={14} className={post.likedByMe ? "fill-current" : ""} /> {post.likesCount}</button>
        <button onClick={() => setOpenComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))} className="flex items-center gap-1.5 text-xs text-[#918a7d]"><MessageCircle size={14} /> {post.comments.length}</button>
      </div>
      {openComments[post.id] && <div className="space-y-2 pt-1">
        {post.comments.map((comment) => <div key={comment.id} className="flex items-start justify-between gap-2 rounded-lg bg-[#faf7ef] px-3 py-1.5 text-xs">
          <div><span className="font-semibold text-[#4b4438]">{comment.authorName}</span> <span className="text-[#5c5445]">{comment.content}</span></div>
          {comment.userId === myUserId && <button onClick={() => deleteComment.mutate({ id: comment.id })} className="shrink-0 text-[#9b9488]"><X size={12} /></button>}
        </div>)}
        <div className="flex gap-2">
          <Input value={commentDrafts[post.id] ?? ""} onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))} placeholder="Escreva um comentário..." className="h-8 rounded-lg text-xs" onKeyDown={(e) => { if (e.key === "Enter" && commentDrafts[post.id]?.trim()) addComment.mutate({ postId: post.id, content: commentDrafts[post.id].trim() }); }} />
          <Button variant="ghost" onClick={() => { if (commentDrafts[post.id]?.trim()) addComment.mutate({ postId: post.id, content: commentDrafts[post.id].trim() }); }} className="h-8 w-8 shrink-0 p-0"><Send size={13} /></Button>
        </div>
      </div>}
    </CardContent></Card>)}
  </div>;
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
      <TreinoDiaCard />
      <DietaAdesaoCard />
      <CompromissoSemanalCard />
      <PontuacaoCard />
      <EvolucaoCard />
    </div>
    <DesafiosSection />
    <CompeticoesSection />
    <FeedSection />
  </div>;
}

export default AlunoArke;
