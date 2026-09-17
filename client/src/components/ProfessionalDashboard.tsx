import { useEffect, useMemo, useState } from "react";
import { Download, IdCard, Plus, Save, Send, Trash2, UserPlus, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { readFileAsBase64 } from "@/lib/upload";
import { ImportacaoDados } from "@/components/ImportacaoDados";

type Toast = { title: string; detail: string };
type Tab = "treinos" | "dieta" | "acolhimento" | "matricula" | "evolucao" | "chat" | "prontuario";

const emptyProgressoForm = { pesoKg: "", gorduraPercentual: "", musculoPercentual: "", cinturaCm: "", quadrilCm: "", bracoCm: "", pernaCm: "", bemEstar: "", observacoes: "" };
const MESES_LABEL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

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

const toDateInputValue = (iso?: string | null) => (iso ? iso.slice(0, 10) : "");

const emptyTreino = { titulo: "", tipo: "A", descricao: "" };
const emptyExercicio = { exercicioId: "", series: "3", repeticoes: "12", descansoSeg: "60", observacoes: "" };
const emptyDieta = { titulo: "", descricao: "", arquivoUrl: "" };
const emptyInvite = { fullName: "", email: "" };
const emptyAlunoCadastro = { nome: "", cpf: "", email: "", telefone: "", dataNascimento: "", responsavelNome: "", responsavelCpf: "", unitId: "", planoId: "", valorMensal: "", diaVencimento: "" };
const emptyTeamInvite = { fullName: "", email: "", role: "professional" as const };
const TEAM_ROLE_LABELS: Record<string, string> = { admin: "Administrador", manager: "Gerente", professional: "Profissional de treino", nutricionista: "Nutricionista", viewer: "Visualizador" };

const ACOLHIMENTO_FIELDS: Array<[string, "rotina_diaria" | "experiencias_exercicio" | "experiencias_gostou" | "experiencias_nao_gostou" | "dores_lesoes" | "medicamentos" | "tempo_disponivel" | "estilo_treino" | "exercicios_nao_gosta" | "alimentos_gosta" | "alimentos_nao_gosta" | "alimentacao_rotina"]> = [
  ["Rotina diária", "rotina_diaria"],
  ["Experiência prévia com exercício", "experiencias_exercicio"],
  ["O que gostou em experiências anteriores", "experiencias_gostou"],
  ["O que não gostou em experiências anteriores", "experiencias_nao_gostou"],
  ["Dores ou lesões", "dores_lesoes"],
  ["Medicamentos em uso", "medicamentos"],
  ["Tempo disponível para treinar", "tempo_disponivel"],
  ["Estilo de treino preferido", "estilo_treino"],
  ["Exercícios que não gosta", "exercicios_nao_gosta"],
  ["Alimentos que gosta", "alimentos_gosta"],
  ["Alimentos que não gosta", "alimentos_nao_gosta"],
  ["Rotina alimentar", "alimentacao_rotina"],
];

export function ProfessionalDashboard({ onToast }: { onToast: (toast: Toast) => void }) {
  const orgsQuery = trpc.prescricao.myOrganizations.useQuery();
  const organizations = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);
  const [organizationId, setOrganizationId] = useState("");
  const activeOrgId = organizationId || organizations[0]?.membership.organization_id || "";
  const activeRole = organizations.find((org) => org.membership.organization_id === activeOrgId)?.membership.role;
  // CLAUDE.md §2: "Profissional de treino" não publica plano alimentar; "Nutricionista" não publica prescrição de treino.
  const canManageTreino = activeRole !== "nutricionista";
  const canManageDieta = activeRole !== "professional";
  const canManageTeam = activeRole === "owner" || activeRole === "admin" || activeRole === "manager";

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
  const uploadDietaArquivo = trpc.prescricao.dietas.uploadArquivo.useMutation();
  const [uploadingArquivo, setUploadingArquivo] = useState(false);
  const handleDietaArquivo = async (file?: File) => {
    if (!file || !alunoId) return;
    setUploadingArquivo(true);
    try {
      const { base64, contentType } = await readFileAsBase64(file);
      const { url } = await uploadDietaArquivo.mutateAsync({ alunoId, contentType, dataBase64: base64 });
      setDietaForm((current) => ({ ...current, arquivoUrl: url }));
      success("Arquivo enviado");
    } catch (error) {
      fail("Erro ao enviar arquivo", error instanceof Error ? error : new Error("Tente novamente."));
    } finally {
      setUploadingArquivo(false);
    }
  };

  // Convite de aluno
  const invitesQuery = trpc.journey.pendingInvitations.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) });
  const invites = invitesQuery.data ?? [];
  const [inviteForm, setInviteForm] = useState(emptyInvite);
  const refreshInvites = () => utils.journey.pendingInvitations.invalidate({ organizationId: activeOrgId });
  const inviteMember = trpc.journey.inviteMember.useMutation({ onSuccess: () => { success("Convite enviado por e-mail"); setInviteForm(emptyInvite); refreshInvites(); }, onError: (e) => fail("Erro ao convidar aluno", e) });
  const revokeInvite = trpc.journey.revokeInvitation.useMutation({ onSuccess: () => { success("Convite revogado"); refreshInvites(); }, onError: (e) => fail("Erro ao revogar convite", e) });

  // Cadastro direto de aluno (sem convite) e importação em massa — o
  // cadastro sempre existe na hora (manual ou importado); o convite acima
  // continua existindo, mas como ação opcional em cima dele (ver
  // 20260916_cadastro_direto_alunos_e_importacao.sql).
  const [alunoPanelMode, setAlunoPanelMode] = useState<"convite" | "cadastro" | "importar">("convite");
  const [alunoCadastroForm, setAlunoCadastroForm] = useState(emptyAlunoCadastro);
  const planosQuery = trpc.planos.list.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) && canManageTeam });
  const planos = planosQuery.data ?? [];
  const alunosCadastradosQuery = trpc.alunos.list.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) && canManageTeam });
  const alunosCadastrados = alunosCadastradosQuery.data ?? [];
  const createAlunoCadastro = trpc.alunos.create.useMutation({
    onSuccess: () => { success("Aluno cadastrado — sem convite enviado"); setAlunoCadastroForm(emptyAlunoCadastro); utils.alunos.list.invalidate({ organizationId: activeOrgId }); },
    onError: (e) => fail("Erro ao cadastrar aluno", e),
  });
  const submitAlunoCadastro = () => {
    if (!alunoCadastroForm.nome.trim()) return;
    createAlunoCadastro.mutate({
      organizationId: activeOrgId,
      nome: alunoCadastroForm.nome.trim(),
      cpf: alunoCadastroForm.cpf.trim() || undefined,
      email: alunoCadastroForm.email.trim() || undefined,
      telefone: alunoCadastroForm.telefone.trim() || undefined,
      dataNascimento: alunoCadastroForm.dataNascimento || undefined,
      responsavelNome: alunoCadastroForm.responsavelNome.trim() || undefined,
      responsavelCpf: alunoCadastroForm.responsavelCpf.trim() || undefined,
      unitId: alunoCadastroForm.unitId || undefined,
      planoId: alunoCadastroForm.planoId || undefined,
      valorMensal: alunoCadastroForm.valorMensal.trim() ? Number(alunoCadastroForm.valorMensal) : undefined,
      diaVencimento: alunoCadastroForm.diaVencimento.trim() ? Number(alunoCadastroForm.diaVencimento) : undefined,
    });
  };

  // Convite de equipe (profissional/nutricionista/gerente) — vínculo por convite (Fase 11)
  const teamInvitesQuery = trpc.saas.organizations.pendingInvitations.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) && canManageTeam });
  const teamInvites = teamInvitesQuery.data ?? [];
  const [teamInviteForm, setTeamInviteForm] = useState<{ fullName: string; email: string; role: "admin" | "manager" | "professional" | "nutricionista" | "viewer" }>(emptyTeamInvite);
  const refreshTeamInvites = () => utils.saas.organizations.pendingInvitations.invalidate({ organizationId: activeOrgId });
  const inviteTeam = trpc.saas.organizations.invite.useMutation({ onSuccess: () => { success("Convite de equipe enviado por e-mail"); setTeamInviteForm(emptyTeamInvite); refreshTeamInvites(); }, onError: (e) => fail("Erro ao convidar colega de equipe", e) });
  const revokeTeamInvite = trpc.saas.organizations.revokeInvitation.useMutation({ onSuccess: () => { success("Convite de equipe revogado"); refreshTeamInvites(); }, onError: (e) => fail("Erro ao revogar convite de equipe", e) });
  const [acceptTeamToken, setAcceptTeamToken] = useState("");
  const [acceptTeamConsent, setAcceptTeamConsent] = useState(false);
  const consentStatusQuery = trpc.journey.getConsentStatus.useQuery();
  const privacyPolicyQuery = trpc.journey.getCurrentPrivacyPolicy.useQuery();
  const needsTermsConsent = consentStatusQuery.data ? !consentStatusQuery.data.termosUsoPrivacidade : true;
  const acceptTeamInvite = trpc.saas.organizations.acceptInvite.useMutation({ onSuccess: () => { success("Convite de equipe aceito"); setAcceptTeamToken(""); setAcceptTeamConsent(false); utils.prescricao.myOrganizations.invalidate(); utils.journey.getConsentStatus.invalidate(); }, onError: (e) => fail("Erro ao aceitar convite de equipe", e) });

  // Acolhimento (somente leitura para o profissional)
  const acolhimentoQuery = trpc.journey.staffAcolhimento.useQuery({ alunoId }, { enabled: Boolean(alunoId) && tab === "acolhimento" });
  const acolhimento = acolhimentoQuery.data;

  // Matrícula e frequência
  const accessQuery = trpc.saas.organizations.access.useQuery({ organizationId: activeOrgId }, { enabled: Boolean(activeOrgId) && (tab === "matricula" || alunoPanelMode === "cadastro") });
  const units = accessQuery.data?.units ?? [];
  const [matriculaForm, setMatriculaForm] = useState({ unitId: "", matriculaEm: "" });
  const updateMatricula = trpc.prescricao.updateMatricula.useMutation({ onSuccess: () => { success("Matrícula atualizada"); utils.prescricao.students.invalidate({ organizationId: activeOrgId }); }, onError: (e) => fail("Erro ao atualizar matrícula", e) });
  const frequenciaQuery = trpc.academia.frequencia.listAluno.useQuery({ alunoId }, { enabled: Boolean(alunoId) && tab === "matricula" });
  const frequencia = frequenciaQuery.data ?? [];
  const registrarFrequencia = trpc.academia.frequencia.registrar.useMutation({ onSuccess: () => { success("Frequência registrada"); utils.academia.frequencia.listAluno.invalidate({ alunoId }); }, onError: (e) => fail("Erro ao registrar frequência", e) });
  const saveMatricula = () => updateMatricula.mutate({ alunoId, unitId: matriculaForm.unitId || null, matriculaEm: matriculaForm.matriculaEm ? new Date(matriculaForm.matriculaEm).toISOString() : null });

  const arkeStatusQuery = trpc.arke.membership.status.useQuery({ alunoId }, { enabled: Boolean(alunoId) && tab === "matricula" });
  const toggleArke = trpc.arke.membership.toggle.useMutation({ onSuccess: (_, variables) => { success(variables.ativo ? "Método Arke ativado para o aluno" : "Método Arke desativado para o aluno"); utils.arke.membership.status.invalidate({ alunoId }); }, onError: (e) => fail("Erro ao atualizar o método Arke", e) });

  // Evolução (medidas corporais) — histórico do aluno, qualquer profissional da equipe pode registrar
  const progressoQuery = trpc.prescricao.progresso.list.useQuery({ alunoId }, { enabled: Boolean(alunoId) && tab === "evolucao" });
  const progressoHistorico = progressoQuery.data ?? [];
  const [progressoForm, setProgressoForm] = useState(emptyProgressoForm);
  const createProgresso = trpc.prescricao.progresso.create.useMutation({ onSuccess: () => { success("Medida registrada"); setProgressoForm(emptyProgressoForm); utils.prescricao.progresso.list.invalidate({ alunoId }); }, onError: (e) => fail("Erro ao registrar medida", e) });
  const deleteProgresso = trpc.prescricao.progresso.delete.useMutation({ onSuccess: () => { success("Registro removido"); utils.prescricao.progresso.list.invalidate({ alunoId }); }, onError: (e) => fail("Erro ao remover registro", e) });
  const submitProgresso = () => {
    const toNumber = (value: string) => (value.trim() === "" ? undefined : Number(value));
    createProgresso.mutate({
      alunoId,
      pesoKg: toNumber(progressoForm.pesoKg),
      gorduraPercentual: toNumber(progressoForm.gorduraPercentual),
      musculoPercentual: toNumber(progressoForm.musculoPercentual),
      cinturaCm: toNumber(progressoForm.cinturaCm),
      quadrilCm: toNumber(progressoForm.quadrilCm),
      bracoCm: toNumber(progressoForm.bracoCm),
      pernaCm: toNumber(progressoForm.pernaCm),
      bemEstar: progressoForm.bemEstar.trim() === "" ? undefined : Number(progressoForm.bemEstar),
      observacoes: progressoForm.observacoes.trim() || undefined,
    });
  };

  // Chat (Fase 3) — treino é 1 thread por aluno; dieta é por plano
  // alimentar, então usamos o mais recente (mesma resolução do app original).
  const latestDietaId = dietas[0]?.id ?? null;
  const chatTreinoQuery = trpc.prescricao.chat.treino.list.useQuery({ alunoId }, { enabled: Boolean(alunoId) && tab === "chat" && canManageTreino });
  const chatTreinoMensagens = chatTreinoQuery.data ?? [];
  const [chatTreinoTexto, setChatTreinoTexto] = useState("");
  const sendChatTreino = trpc.prescricao.chat.treino.send.useMutation({ onSuccess: () => { setChatTreinoTexto(""); utils.prescricao.chat.treino.list.invalidate({ alunoId }); }, onError: (e) => fail("Erro ao enviar mensagem", e) });
  const sendChatTreinoVideo = trpc.prescricao.chat.treino.sendVideo.useMutation({ onSuccess: () => utils.prescricao.chat.treino.list.invalidate({ alunoId }), onError: (e) => fail("Erro ao enviar vídeo", e) });
  const [uploadingChatVideo, setUploadingChatVideo] = useState(false);
  const handleChatTreinoVideo = async (file?: File) => {
    if (!file) return;
    setUploadingChatVideo(true);
    try {
      const { base64, contentType } = await readFileAsBase64(file);
      await sendChatTreinoVideo.mutateAsync({ alunoId, contentType, dataBase64: base64 });
    } catch (error) {
      fail("Erro ao enviar vídeo", error instanceof Error ? error : new Error("Tente novamente."));
    } finally {
      setUploadingChatVideo(false);
    }
  };
  const markChatTreinoRead = trpc.prescricao.chat.treino.markRead.useMutation();

  const chatDietaQuery = trpc.prescricao.chat.dieta.list.useQuery({ dietaId: latestDietaId ?? "" }, { enabled: Boolean(latestDietaId) && tab === "chat" && canManageDieta });
  const chatDietaMensagens = chatDietaQuery.data ?? [];
  const [chatDietaTexto, setChatDietaTexto] = useState("");
  const sendChatDieta = trpc.prescricao.chat.dieta.send.useMutation({ onSuccess: () => { setChatDietaTexto(""); utils.prescricao.chat.dieta.list.invalidate({ dietaId: latestDietaId ?? "" }); }, onError: (e) => fail("Erro ao enviar mensagem", e) });
  const markChatDietaRead = trpc.prescricao.chat.dieta.markRead.useMutation();

  // Prontuário (Fase 3) — notas privadas da equipe por mês/ano, nunca visíveis ao aluno.
  const now = new Date();
  const [prontuarioMes, setProntuarioMes] = useState(now.getMonth() + 1);
  const [prontuarioAno, setProntuarioAno] = useState(now.getFullYear());
  const prontuarioQuery = trpc.prescricao.prontuario.list.useQuery({ alunoId }, { enabled: Boolean(alunoId) && tab === "prontuario" });
  const prontuarioHistorico = prontuarioQuery.data ?? [];
  const prontuarioAtual = prontuarioHistorico.find((item) => item.mes === prontuarioMes && item.ano === prontuarioAno);
  const [prontuarioTexto, setProntuarioTexto] = useState("");
  useEffect(() => { if (!prontuarioQuery.isLoading) setProntuarioTexto(prontuarioAtual?.observacao ?? ""); }, [prontuarioMes, prontuarioAno, prontuarioQuery.isLoading, prontuarioAtual?.observacao]);
  const saveProntuario = trpc.prescricao.prontuario.upsert.useMutation({ onSuccess: () => { success("Nota salva"); utils.prescricao.prontuario.list.invalidate({ alunoId }); }, onError: (e) => fail("Erro ao salvar nota", e) });

  const [downloadingFichaId, setDownloadingFichaId] = useState<string | null>(null);
  const downloadFicha = async (treino: { id: string; titulo: string }) => {
    setDownloadingFichaId(treino.id);
    try {
      const ficha = await utils.prescricao.treinos.fichaPdf.fetch({ id: treino.id });
      downloadBase64Pdf(ficha.filename, ficha.contentBase64);
    } catch (error) {
      fail("Erro ao gerar ficha em PDF", error as { message: string });
    } finally {
      setDownloadingFichaId(null);
    }
  };

  const selectAluno = (id: string) => {
    setAlunoId(id);
    setTreinoId(null);
    setDietaId(null);
    setTab(canManageTreino ? "treinos" : canManageDieta ? "dieta" : "acolhimento");
    const aluno = students.find((student) => student.user_id === id);
    setMatriculaForm({ unitId: aluno?.unit_id ?? "", matriculaEm: toDateInputValue(aluno?.matricula_em) });
  };

  if (orgsQuery.isLoading) return <div className="p-8 text-sm text-[#918a7d]">Carregando organizações...</div>;
  if (!organizations.length) return <div className="mx-auto max-w-lg p-8 text-center text-sm text-[#918a7d]">Sua conta não está vinculada a nenhuma organização como profissional. Peça para o administrador te convidar.</div>;

  return <div className="mx-auto max-w-[1440px] p-5 sm:p-8">
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><h2 className="text-3xl font-semibold tracking-[-.05em] text-[#2b271f]">Meus alunos</h2><p className="mt-1 text-sm text-[#77877d]">Gerencie treino e plano alimentar dos alunos da sua organização.</p></div>
      {organizations.length > 1 && <select value={activeOrgId} onChange={(e) => { setOrganizationId(e.target.value); setAlunoId(""); }} className="h-10 rounded-xl border bg-white px-3 text-xs"><option value="">Selecione a organização</option>{organizations.map((org) => <option key={org.membership.organization_id} value={org.membership.organization_id}>{org.organization.name}</option>)}</select>}
    </div>
    <div className="grid gap-5 lg:grid-cols-[.7fr_1.3fr]">
      <div className="space-y-5">
      <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Alunos</CardTitle></CardHeader><CardContent className="space-y-1">
        {studentsQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando alunos...</p>}
        {!studentsQuery.isLoading && students.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum aluno cadastrado nesta organização ainda.</p>}
        {students.map((student) => <button key={student.user_id} onClick={() => selectAluno(student.user_id)} className={`w-full rounded-xl px-3 py-2.5 text-left text-sm ${alunoId === student.user_id ? "bg-[#15130f] font-semibold text-white" : "text-[#4b4438] hover:bg-[#faf7ef]"}`}>{student.full_name || "Aluno sem nome"}</button>)}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={() => setAlunoPanelMode("convite")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${alunoPanelMode === "convite" ? "bg-[#15130f] text-white" : "bg-[#faf7ef] text-[#4b4438]"}`}>Convidar</button>
          {canManageTeam && <button onClick={() => setAlunoPanelMode("cadastro")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${alunoPanelMode === "cadastro" ? "bg-[#15130f] text-white" : "bg-[#faf7ef] text-[#4b4438]"}`}>Cadastro direto</button>}
          {canManageTeam && <button onClick={() => setAlunoPanelMode("importar")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${alunoPanelMode === "importar" ? "bg-[#15130f] text-white" : "bg-[#faf7ef] text-[#4b4438]"}`}>Importar</button>}
        </div>

        {alunoPanelMode === "convite" && <div className="mt-2 space-y-2 rounded-xl bg-[#faf7ef] p-3">
          <p className="text-xs font-semibold text-[#4b4438]">Convidar aluno</p>
          <p className="text-[10px] text-[#9b9488]">Manda um convite por e-mail para o aluno criar a própria conta e acessar o app.</p>
          <Input value={inviteForm.fullName} onChange={(e) => setInviteForm({ ...inviteForm, fullName: e.target.value })} placeholder="Nome completo" className="h-9 rounded-lg text-xs" />
          <Input value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="E-mail" type="email" className="h-9 rounded-lg text-xs" />
          <Button onClick={() => inviteMember.mutate({ organizationId: activeOrgId, email: inviteForm.email, fullName: inviteForm.fullName })} disabled={!inviteForm.fullName || !inviteForm.email || inviteMember.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Enviar convite</Button>
          {invites.length > 0 && <div className="mt-2 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#9b9488]">Convites pendentes</p>
            {invites.map((invite) => <div key={invite.id} className="flex items-center justify-between rounded-lg border border-[#eee9df] bg-white p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#4b4438]">{invite.full_name}</p><p className="truncate text-[10px] text-[#9b9488]">{invite.email}</p></div><Button variant="ghost" onClick={() => revokeInvite.mutate({ id: invite.id, organizationId: activeOrgId })} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>)}
          </div>}
        </div>}

        {alunoPanelMode === "cadastro" && canManageTeam && <div className="mt-2 space-y-2 rounded-xl bg-[#faf7ef] p-3">
          <p className="text-xs font-semibold text-[#4b4438]">Cadastro direto de aluno</p>
          <p className="text-[10px] text-[#9b9488]">Cria o cadastro completo agora, sem enviar convite — o aluno pode ser convidado ao app depois, se quiser.</p>
          <Input value={alunoCadastroForm.nome} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, nome: e.target.value })} placeholder="Nome completo" className="h-9 rounded-lg text-xs" />
          <div className="grid grid-cols-2 gap-2"><Input value={alunoCadastroForm.cpf} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, cpf: e.target.value })} placeholder="CPF" className="h-9 rounded-lg text-xs" /><Input value={alunoCadastroForm.telefone} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, telefone: e.target.value })} placeholder="Telefone" className="h-9 rounded-lg text-xs" /></div>
          <Input value={alunoCadastroForm.email} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, email: e.target.value })} placeholder="E-mail (opcional)" type="email" className="h-9 rounded-lg text-xs" />
          <div><label className="mb-1 block text-[10px] font-semibold text-[#9b9488]">Data de nascimento</label><Input value={alunoCadastroForm.dataNascimento} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, dataNascimento: e.target.value })} type="date" className="h-9 rounded-lg text-xs" /></div>
          <div className="grid grid-cols-2 gap-2"><Input value={alunoCadastroForm.responsavelNome} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, responsavelNome: e.target.value })} placeholder="Responsável (se menor)" className="h-9 rounded-lg text-xs" /><Input value={alunoCadastroForm.responsavelCpf} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, responsavelCpf: e.target.value })} placeholder="CPF do responsável" className="h-9 rounded-lg text-xs" /></div>
          <select value={alunoCadastroForm.unitId} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, unitId: e.target.value })} className="h-9 w-full rounded-lg border bg-white px-2 text-xs"><option value="">Sem unidade definida</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>
          <select value={alunoCadastroForm.planoId} onChange={(e) => { const plano = planos.find((p) => p.id === e.target.value); setAlunoCadastroForm({ ...alunoCadastroForm, planoId: e.target.value, valorMensal: plano ? String(plano.valor_mensal) : alunoCadastroForm.valorMensal }); }} className="h-9 w-full rounded-lg border bg-white px-2 text-xs"><option value="">Sem plano de mensalidade</option>{planos.map((plano) => <option key={plano.id} value={plano.id}>{plano.nome} · R$ {plano.valor_mensal}</option>)}</select>
          <div className="grid grid-cols-2 gap-2"><Input value={alunoCadastroForm.valorMensal} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, valorMensal: e.target.value })} placeholder="Valor mensal (R$)" type="number" className="h-9 rounded-lg text-xs" /><Input value={alunoCadastroForm.diaVencimento} onChange={(e) => setAlunoCadastroForm({ ...alunoCadastroForm, diaVencimento: e.target.value })} placeholder="Dia de vencimento" type="number" min={1} max={31} className="h-9 rounded-lg text-xs" /></div>
          <Button onClick={submitAlunoCadastro} disabled={!alunoCadastroForm.nome.trim() || createAlunoCadastro.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Cadastrar aluno</Button>
          {alunosCadastrados.length > 0 && <div className="mt-2 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#9b9488]">Cadastrados administrativamente ({alunosCadastrados.length})</p>
            <div className="max-h-48 space-y-1 overflow-y-auto">{alunosCadastrados.map((aluno) => <div key={aluno.id} className="flex items-center justify-between rounded-lg border border-[#eee9df] bg-white p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#4b4438]">{aluno.nome}</p><p className="truncate text-[10px] text-[#9b9488]">{aluno.email || aluno.telefone || "sem contato"} · {aluno.origem === "importado" ? "importado" : "manual"}{aluno.auth_user_id ? " · com acesso ao app" : ""}</p></div></div>)}</div>
          </div>}
        </div>}

        {alunoPanelMode === "importar" && canManageTeam && <div className="mt-2"><ImportacaoDados organizationId={activeOrgId} onToast={onToast} entities={["alunos", "planos", "unidades", "leads", "turmas"]} /></div>}
      </CardContent></Card>

      <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-base text-[#2b271f]">Equipe</CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="space-y-2 rounded-xl bg-[#faf7ef] p-3">
          <p className="text-xs font-semibold text-[#4b4438]">Tenho um convite de equipe</p>
          <Input value={acceptTeamToken} onChange={(e) => setAcceptTeamToken(e.target.value)} placeholder="Código de convite" className="h-9 rounded-lg text-xs" />
          {needsTermsConsent && <>
            {privacyPolicyQuery.data && <div className="max-h-24 overflow-y-auto rounded-lg border border-[#e5ece5] bg-white p-2 text-[11px] leading-4 text-[#766f62]">{privacyPolicyQuery.data.content}</div>}
            <label className="flex items-start gap-2 text-xs text-[#766f62]"><input type="checkbox" checked={acceptTeamConsent} onChange={(e) => setAcceptTeamConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#4c9a6a]" /> Li e aceito os Termos de Uso e a Política de Privacidade{privacyPolicyQuery.data ? ` (versão ${privacyPolicyQuery.data.version})` : ""}.</label>
          </>}
          <Button onClick={() => acceptTeamInvite.mutate({ token: acceptTeamToken.trim(), consentTermos: true })} disabled={!acceptTeamToken.trim() || acceptTeamInvite.isPending || (needsTermsConsent && !acceptTeamConsent)} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><UserPlus size={14} /> Aceitar convite</Button>
        </div>
        {canManageTeam && <div className="space-y-2 rounded-xl bg-[#faf7ef] p-3">
          <p className="text-xs font-semibold text-[#4b4438]">Convidar profissional ou nutricionista</p>
          <Input value={teamInviteForm.fullName} onChange={(e) => setTeamInviteForm({ ...teamInviteForm, fullName: e.target.value })} placeholder="Nome completo" className="h-9 rounded-lg text-xs" />
          <Input value={teamInviteForm.email} onChange={(e) => setTeamInviteForm({ ...teamInviteForm, email: e.target.value })} placeholder="E-mail" type="email" className="h-9 rounded-lg text-xs" />
          <select value={teamInviteForm.role} onChange={(e) => setTeamInviteForm({ ...teamInviteForm, role: e.target.value as typeof teamInviteForm.role })} className="h-9 w-full rounded-lg border bg-white px-2 text-xs">{Object.entries(TEAM_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <Button onClick={() => inviteTeam.mutate({ organizationId: activeOrgId, email: teamInviteForm.email, fullName: teamInviteForm.fullName, role: teamInviteForm.role })} disabled={!teamInviteForm.email || !teamInviteForm.fullName.trim() || inviteTeam.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Enviar convite</Button>
          {teamInvites.length > 0 && <div className="mt-2 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#9b9488]">Convites pendentes</p>
            {teamInvites.map((invite) => <div key={invite.id} className="flex items-center justify-between rounded-lg border border-[#eee9df] bg-white p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#4b4438]">{invite.email}</p><p className="truncate text-[10px] text-[#9b9488]">{TEAM_ROLE_LABELS[invite.role] ?? invite.role}</p></div><Button variant="ghost" onClick={() => revokeTeamInvite.mutate({ organizationId: activeOrgId, invitationId: invite.id })} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>)}
          </div>}
        </div>}
      </CardContent></Card>
      </div>

      <div>
        {!selectedAluno && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardContent className="p-8 text-center text-sm text-[#918a7d]">Selecione um aluno para gerenciar treino e plano alimentar.</CardContent></Card>}
        {selectedAluno && <>
          <div className="mb-4 flex gap-2">{canManageTreino && <Button variant={tab === "treinos" ? "default" : "outline"} onClick={() => setTab("treinos")} className="h-9 rounded-xl text-xs">Treinos</Button>}{canManageDieta && <Button variant={tab === "dieta" ? "default" : "outline"} onClick={() => setTab("dieta")} className="h-9 rounded-xl text-xs">Plano alimentar</Button>}<Button variant={tab === "acolhimento" ? "default" : "outline"} onClick={() => setTab("acolhimento")} className="h-9 rounded-xl text-xs">Acolhimento</Button><Button variant={tab === "evolucao" ? "default" : "outline"} onClick={() => setTab("evolucao")} className="h-9 rounded-xl text-xs">Evolução</Button><Button variant={tab === "chat" ? "default" : "outline"} onClick={() => { setTab("chat"); if (canManageTreino) markChatTreinoRead.mutate({ alunoId }); if (canManageDieta && latestDietaId) markChatDietaRead.mutate({ dietaId: latestDietaId }); }} className="h-9 rounded-xl text-xs">Chat</Button><Button variant={tab === "prontuario" ? "default" : "outline"} onClick={() => setTab("prontuario")} className="h-9 rounded-xl text-xs">Prontuário</Button><Button variant={tab === "matricula" ? "default" : "outline"} onClick={() => setTab("matricula")} className="h-9 rounded-xl text-xs">Matrícula</Button></div>

          {tab === "evolucao" && <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Nova medida de {selectedAluno.full_name}</CardTitle></CardHeader><CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Input value={progressoForm.pesoKg} onChange={(e) => setProgressoForm({ ...progressoForm, pesoKg: e.target.value })} placeholder="Peso (kg)" type="number" className="h-9 rounded-lg text-xs" />
                <Input value={progressoForm.gorduraPercentual} onChange={(e) => setProgressoForm({ ...progressoForm, gorduraPercentual: e.target.value })} placeholder="Gordura (%)" type="number" className="h-9 rounded-lg text-xs" />
                <Input value={progressoForm.musculoPercentual} onChange={(e) => setProgressoForm({ ...progressoForm, musculoPercentual: e.target.value })} placeholder="Músculo (%)" type="number" className="h-9 rounded-lg text-xs" />
                <Input value={progressoForm.cinturaCm} onChange={(e) => setProgressoForm({ ...progressoForm, cinturaCm: e.target.value })} placeholder="Cintura (cm)" type="number" className="h-9 rounded-lg text-xs" />
                <Input value={progressoForm.quadrilCm} onChange={(e) => setProgressoForm({ ...progressoForm, quadrilCm: e.target.value })} placeholder="Quadril (cm)" type="number" className="h-9 rounded-lg text-xs" />
                <Input value={progressoForm.bracoCm} onChange={(e) => setProgressoForm({ ...progressoForm, bracoCm: e.target.value })} placeholder="Braço (cm)" type="number" className="h-9 rounded-lg text-xs" />
                <Input value={progressoForm.pernaCm} onChange={(e) => setProgressoForm({ ...progressoForm, pernaCm: e.target.value })} placeholder="Perna (cm)" type="number" className="h-9 rounded-lg text-xs" />
                <Input value={progressoForm.bemEstar} onChange={(e) => setProgressoForm({ ...progressoForm, bemEstar: e.target.value })} placeholder="Bem-estar (1-5)" type="number" min={1} max={5} className="h-9 rounded-lg text-xs" />
              </div>
              <textarea value={progressoForm.observacoes} onChange={(e) => setProgressoForm({ ...progressoForm, observacoes: e.target.value })} placeholder="Observações (opcional)" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" />
              <Button onClick={submitProgresso} disabled={createProgresso.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Registrar medida</Button>
            </CardContent></Card>
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Histórico</CardTitle></CardHeader><CardContent className="space-y-2">
              {progressoQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando...</p>}
              {!progressoQuery.isLoading && progressoHistorico.length === 0 && <p className="text-xs text-[#918a7d]">Nenhuma medida registrada ainda.</p>}
              {[...progressoHistorico].reverse().map((registro) => <div key={registro.id} className="flex items-start justify-between gap-2 rounded-lg bg-[#faf7ef] px-3 py-2 text-xs text-[#5c5445]">
                <div><p className="font-semibold text-[#4b4438]">{new Date(`${registro.data}T00:00:00`).toLocaleDateString("pt-BR")}</p>
                  <p>{[registro.peso_kg != null ? `${registro.peso_kg}kg` : null, registro.gordura_percentual != null ? `${registro.gordura_percentual}% gordura` : null, registro.musculo_percentual != null ? `${registro.musculo_percentual}% músculo` : null, registro.cintura_cm != null ? `cintura ${registro.cintura_cm}cm` : null, registro.quadril_cm != null ? `quadril ${registro.quadril_cm}cm` : null, registro.braco_cm != null ? `braço ${registro.braco_cm}cm` : null, registro.perna_cm != null ? `perna ${registro.perna_cm}cm` : null].filter(Boolean).join(" · ") || "Sem medidas numéricas"}</p>
                  {registro.observacoes && <p className="mt-0.5 text-[#918a7d]">"{registro.observacoes}"</p>}
                </div>
                <Button variant="ghost" onClick={() => { if (window.confirm("Remover este registro?")) deleteProgresso.mutate({ id: registro.id }); }} className="h-7 w-7 shrink-0 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button>
              </div>)}
            </CardContent></Card>
          </div>}

          {tab === "chat" && <div className="grid gap-4 lg:grid-cols-2">
            {canManageTreino && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Chat de treino</CardTitle></CardHeader><CardContent className="space-y-2">
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg bg-[#faf7ef] p-2">
                {chatTreinoQuery.isLoading && <p className="p-2 text-xs text-[#918a7d]">Carregando...</p>}
                {!chatTreinoQuery.isLoading && chatTreinoMensagens.length === 0 && <p className="p-2 text-xs text-[#918a7d]">Nenhuma mensagem ainda.</p>}
                {chatTreinoMensagens.map((msg) => <div key={msg.id} className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs ${msg.remetente_tipo === "treinador" ? "ml-auto bg-[#15130f] text-white" : "bg-white text-[#4b4438]"}`}>
                  {msg.video_url ? <video src={msg.video_url} controls preload="metadata" className="max-h-40 max-w-full rounded-lg" /> : <p className="whitespace-pre-wrap">{msg.mensagem}</p>}
                  <p className={`mt-0.5 text-[9px] ${msg.remetente_tipo === "treinador" ? "text-white/60" : "text-[#9b9488]"}`}>{new Date(msg.created_at).toLocaleString("pt-BR")}</p>
                </div>)}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => document.getElementById("chat-treino-video-input")?.click()} disabled={uploadingChatVideo} className="h-9 w-9 shrink-0 p-0"><Video size={16} /></Button>
                <input id="chat-treino-video-input" type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => handleChatTreinoVideo(e.target.files?.[0])} />
                <Input value={chatTreinoTexto} onChange={(e) => setChatTreinoTexto(e.target.value)} placeholder="Responder..." className="h-9 flex-1 rounded-lg text-xs" onKeyDown={(e) => { if (e.key === "Enter" && chatTreinoTexto.trim()) sendChatTreino.mutate({ alunoId, mensagem: chatTreinoTexto.trim() }); }} />
                <Button onClick={() => chatTreinoTexto.trim() && sendChatTreino.mutate({ alunoId, mensagem: chatTreinoTexto.trim() })} disabled={!chatTreinoTexto.trim() || sendChatTreino.isPending} className="h-9 w-9 shrink-0 rounded-lg bg-[#15130f] p-0 text-white"><Send size={14} /></Button>
              </div>
            </CardContent></Card>}
            {canManageDieta && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Chat de nutrição</CardTitle></CardHeader><CardContent className="space-y-2">
              {!latestDietaId && <p className="text-xs text-[#918a7d]">Nenhum plano alimentar cadastrado para este aluno.</p>}
              {latestDietaId && <>
                <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg bg-[#faf7ef] p-2">
                  {chatDietaQuery.isLoading && <p className="p-2 text-xs text-[#918a7d]">Carregando...</p>}
                  {!chatDietaQuery.isLoading && chatDietaMensagens.length === 0 && <p className="p-2 text-xs text-[#918a7d]">Nenhuma mensagem ainda.</p>}
                  {chatDietaMensagens.map((msg) => <div key={msg.id} className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs ${msg.remetente_tipo === "nutricionista" ? "ml-auto bg-[#15130f] text-white" : "bg-white text-[#4b4438]"}`}>
                    <p className="whitespace-pre-wrap">{msg.mensagem}</p>
                    <p className={`mt-0.5 text-[9px] ${msg.remetente_tipo === "nutricionista" ? "text-white/60" : "text-[#9b9488]"}`}>{new Date(msg.created_at).toLocaleString("pt-BR")}</p>
                  </div>)}
                </div>
                <div className="flex items-center gap-2">
                  <Input value={chatDietaTexto} onChange={(e) => setChatDietaTexto(e.target.value)} placeholder="Responder..." className="h-9 flex-1 rounded-lg text-xs" onKeyDown={(e) => { if (e.key === "Enter" && chatDietaTexto.trim()) sendChatDieta.mutate({ dietaId: latestDietaId, mensagem: chatDietaTexto.trim() }); }} />
                  <Button onClick={() => chatDietaTexto.trim() && sendChatDieta.mutate({ dietaId: latestDietaId, mensagem: chatDietaTexto.trim() })} disabled={!chatDietaTexto.trim() || sendChatDieta.isPending} className="h-9 w-9 shrink-0 rounded-lg bg-[#15130f] p-0 text-white"><Send size={14} /></Button>
                </div>
              </>}
            </CardContent></Card>}
          </div>}

          {tab === "prontuario" && <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Nota do mês</CardTitle><p className="text-xs text-[#918a7d]">Visível só para a equipe — nunca para o aluno.</p></CardHeader><CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select value={prontuarioMes} onChange={(e) => setProntuarioMes(Number(e.target.value))} className="h-9 rounded-lg border bg-white px-2 text-xs">{MESES_LABEL.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select>
                <Input value={prontuarioAno} onChange={(e) => setProntuarioAno(Number(e.target.value) || now.getFullYear())} type="number" className="h-9 rounded-lg text-xs" />
              </div>
              <textarea value={prontuarioTexto} onChange={(e) => setProntuarioTexto(e.target.value)} placeholder="Observações da equipe sobre este aluno neste mês..." className="min-h-32 w-full rounded-lg border bg-white p-2 text-xs" />
              <Button onClick={() => saveProntuario.mutate({ alunoId, mes: prontuarioMes, ano: prontuarioAno, observacao: prontuarioTexto })} disabled={saveProntuario.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Save size={14} /> Salvar nota</Button>
            </CardContent></Card>
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Histórico</CardTitle></CardHeader><CardContent className="space-y-2">
              {prontuarioQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando...</p>}
              {!prontuarioQuery.isLoading && prontuarioHistorico.length === 0 && <p className="text-xs text-[#918a7d]">Nenhuma nota registrada ainda.</p>}
              {prontuarioHistorico.map((item) => <div key={item.id} className="rounded-lg bg-[#faf7ef] p-3 text-xs text-[#5c5445]"><p className="font-semibold text-[#4b4438]">{MESES_LABEL[item.mes - 1]} de {item.ano}</p><p className="mt-1 whitespace-pre-wrap">{item.observacao}</p></div>)}
            </CardContent></Card>
          </div>}

          {tab === "matricula" && <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Matrícula de {selectedAluno.full_name}</CardTitle></CardHeader><CardContent className="space-y-3">
              <div><label className="mb-1 block text-xs font-semibold text-[#4b4438]">Unidade</label><select value={matriculaForm.unitId} onChange={(e) => setMatriculaForm({ ...matriculaForm, unitId: e.target.value })} className="h-9 w-full rounded-lg border bg-white px-2 text-xs"><option value="">Sem unidade definida</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></div>
              <div><label className="mb-1 block text-xs font-semibold text-[#4b4438]">Data de matrícula</label><Input value={matriculaForm.matriculaEm} onChange={(e) => setMatriculaForm({ ...matriculaForm, matriculaEm: e.target.value })} type="date" className="h-9 rounded-lg text-xs" /></div>
              <Button onClick={saveMatricula} disabled={updateMatricula.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Save size={14} /> Salvar matrícula</Button>
            </CardContent></Card>
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Frequência</CardTitle></CardHeader><CardContent className="space-y-3">
              <Button onClick={() => registrarFrequencia.mutate({ alunoId })} disabled={registrarFrequencia.isPending} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><IdCard size={14} /> Registrar visita agora</Button>
              <div className="space-y-1.5">
                {frequenciaQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando...</p>}
                {!frequenciaQuery.isLoading && frequencia.length === 0 && <p className="text-xs text-[#918a7d]">Nenhuma frequência registrada ainda.</p>}
                {frequencia.slice(0, 10).map((registro) => <div key={registro.id} className="flex items-center justify-between rounded-lg bg-[#faf7ef] px-3 py-2 text-xs text-[#5c5445]"><span>{new Date(registro.registrado_em).toLocaleString("pt-BR")}</span><span className="text-[10px] uppercase tracking-wide text-[#9b9488]">{registro.origem === "catraca" ? "Catraca" : "Manual"}</span></div>)}
              </div>
            </CardContent></Card>
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Método Arke</CardTitle></CardHeader><CardContent className="space-y-3">
              {arkeStatusQuery.isLoading && <p className="text-xs text-[#918a7d]">Carregando...</p>}
              {!arkeStatusQuery.isLoading && !arkeStatusQuery.data?.moduleEnabled && <p className="text-xs text-[#918a7d]">Sua organização ainda não habilitou o módulo Arke (configurável em Licenças &amp; planos).</p>}
              {!arkeStatusQuery.isLoading && arkeStatusQuery.data?.moduleEnabled && <><p className="text-xs text-[#5c5445]">{arkeStatusQuery.data.ativo ? `${selectedAluno.full_name} tem acesso ao conteúdo completo do método Arke.` : `${selectedAluno.full_name} ainda não tem o método Arke — vê só o treino/dieta padrão.`}</p><Button onClick={() => toggleArke.mutate({ alunoId, ativo: !arkeStatusQuery.data?.ativo })} disabled={toggleArke.isPending} className={`h-9 w-full rounded-lg text-xs text-white ${arkeStatusQuery.data.ativo ? "bg-[#b65c4d]" : "bg-[#15130f]"}`}>{arkeStatusQuery.data.ativo ? "Desativar método Arke" : "Ativar método Arke"}</Button></>}
            </CardContent></Card>
          </div>}

          {tab === "acolhimento" && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Acolhimento de {selectedAluno.full_name}</CardTitle></CardHeader><CardContent className="space-y-3 text-xs">
            {acolhimentoQuery.isLoading && <p className="text-[#918a7d]">Carregando...</p>}
            {!acolhimentoQuery.isLoading && !acolhimento && <p className="text-[#918a7d]">Este aluno ainda não preencheu o acolhimento.</p>}
            {acolhimento && ACOLHIMENTO_FIELDS.map(([label, field]) => acolhimento[field] ? <div key={field}><p className="font-semibold text-[#2b271f]">{label}</p><p className="mt-0.5 whitespace-pre-wrap text-[#5c5445]">{acolhimento[field]}</p></div> : null)}
          </CardContent></Card>}

          {tab === "treinos" && canManageTreino && <div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Treinos de {selectedAluno.full_name}</CardTitle></CardHeader><CardContent className="space-y-2">
              {treinos.map((treino) => <div key={treino.id} className={`flex items-center justify-between rounded-xl border p-2.5 ${treinoId === treino.id ? "border-[#15130f]" : "border-[#eee9df]"}`}><button onClick={() => beginTreino(treino.id)} className="min-w-0 flex-1 text-left"><p className="truncate text-xs font-semibold text-[#4b4438]">{treino.titulo} · {treino.tipo}</p><p className="text-[10px] text-[#9b9488]">{treino.estado_publicacao} · v{treino.versao}</p></button><Button variant="ghost" onClick={() => { if (window.confirm("Remover este treino?")) deleteTreino.mutate({ id: treino.id }); }} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>)}
              {treinos.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum treino criado ainda.</p>}
              <div className="mt-3 space-y-2 rounded-xl bg-[#faf7ef] p-3"><p className="text-xs font-semibold text-[#4b4438]">Novo treino</p><div className="grid grid-cols-[1fr_80px] gap-2"><Input value={treinoForm.titulo} onChange={(e) => setTreinoForm({ ...treinoForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" /><Input value={treinoForm.tipo} onChange={(e) => setTreinoForm({ ...treinoForm, tipo: e.target.value })} placeholder="Tipo" className="h-9 rounded-lg text-xs" /></div><textarea value={treinoForm.descricao} onChange={(e) => setTreinoForm({ ...treinoForm, descricao: e.target.value })} placeholder="Descrição (opcional)" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" /><Button onClick={() => createTreino.mutate({ alunoId, titulo: treinoForm.titulo, tipo: treinoForm.tipo || "A", descricao: treinoForm.descricao || undefined })} disabled={!treinoForm.titulo} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Criar rascunho</Button></div>
            </CardContent></Card>

            {selectedTreino && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">{selectedTreino.titulo} · {selectedTreino.tipo}</CardTitle><p className="text-[10px] text-[#9b9488]">{selectedTreino.estado_publicacao} · versão {selectedTreino.versao}</p></CardHeader><CardContent className="space-y-4">
              <div className="grid grid-cols-[1fr_80px] gap-2"><Input defaultValue={selectedTreino.titulo} onChange={(e) => setTreinoForm({ ...treinoForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" /><Input defaultValue={selectedTreino.tipo} onChange={(e) => setTreinoForm({ ...treinoForm, tipo: e.target.value })} placeholder="Tipo" className="h-9 rounded-lg text-xs" /></div>
              <textarea defaultValue={selectedTreino.descricao ?? ""} onChange={(e) => setTreinoForm({ ...treinoForm, descricao: e.target.value })} placeholder="Descrição" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" />
              <div className="flex gap-2"><Button variant="outline" onClick={saveTreinoHeader} className="h-9 flex-1 rounded-lg text-xs"><Save size={14} /> Salvar</Button><Button onClick={() => publishTreino.mutate({ id: selectedTreino.id })} disabled={publishTreino.isPending} className="h-9 flex-1 rounded-lg bg-[#15130f] text-xs text-white"><Send size={14} /> Publicar</Button></div>
              <Button variant="outline" onClick={() => downloadFicha(selectedTreino)} disabled={downloadingFichaId === selectedTreino.id} className="h-9 w-full rounded-lg text-xs"><Download size={14} /> Baixar ficha (impressora térmica)</Button>

              <div className="rounded-xl border border-[#eee9df] p-3"><p className="mb-2 text-xs font-semibold text-[#4b4438]">Exercícios</p>
                <div className="mb-3 space-y-2">{treinoExercicios.map((item) => { const exercicio = exercises.find((ex) => ex.id === item.exercicio_id); return <div key={item.id} className="flex items-center gap-2 rounded-lg border border-[#eee9df] p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#4b4438]">{exercicio?.nome ?? "Exercício removido"}</p><p className="text-[10px] text-[#9b9488]">{item.series}x{item.repeticoes} · descanso {item.descanso_seg}s{item.observacoes ? ` · ${item.observacoes}` : ""}</p></div><Button variant="ghost" onClick={() => removeExercicio(item.id)} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>; })}
                {treinoExercicios.length === 0 && <p className="text-[10px] text-[#918a7d]">Nenhum exercício adicionado.</p>}</div>
                <div className="grid gap-2 sm:grid-cols-5"><select value={exercicioForm.exercicioId} onChange={(e) => setExercicioForm({ ...exercicioForm, exercicioId: e.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs sm:col-span-2"><option value="">Selecione o exercício</option>{exercises.map((ex) => <option key={ex.id} value={ex.id}>{ex.nome}</option>)}</select><Input value={exercicioForm.series} onChange={(e) => setExercicioForm({ ...exercicioForm, series: e.target.value })} placeholder="Séries" type="number" className="h-9 rounded-lg text-xs" /><Input value={exercicioForm.repeticoes} onChange={(e) => setExercicioForm({ ...exercicioForm, repeticoes: e.target.value })} placeholder="Repetições" className="h-9 rounded-lg text-xs" /><Input value={exercicioForm.descansoSeg} onChange={(e) => setExercicioForm({ ...exercicioForm, descansoSeg: e.target.value })} placeholder="Descanso (s)" type="number" className="h-9 rounded-lg text-xs" /></div>
                <Input value={exercicioForm.observacoes} onChange={(e) => setExercicioForm({ ...exercicioForm, observacoes: e.target.value })} placeholder="Observações (opcional)" className="mt-2 h-9 rounded-lg text-xs" />
                <Button onClick={addExercicio} disabled={!exercicioForm.exercicioId} className="mt-2 h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Adicionar exercício</Button>
              </div>
            </CardContent></Card>}
          </div>}

          {tab === "dieta" && canManageDieta && <div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
            <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">Planos de {selectedAluno.full_name}</CardTitle></CardHeader><CardContent className="space-y-2">
              {dietas.map((dieta) => <div key={dieta.id} className={`flex items-center justify-between rounded-xl border p-2.5 ${dietaId === dieta.id ? "border-[#15130f]" : "border-[#eee9df]"}`}><button onClick={() => beginDieta(dieta.id)} className="min-w-0 flex-1 text-left"><p className="truncate text-xs font-semibold text-[#4b4438]">{dieta.titulo}</p><p className="text-[10px] text-[#9b9488]">{dieta.estado_publicacao} · v{dieta.versao}</p></button><Button variant="ghost" onClick={() => { if (window.confirm("Remover este plano alimentar?")) deleteDieta.mutate({ id: dieta.id }); }} className="h-7 w-7 p-0 text-[#b65c4d]"><Trash2 size={13} /></Button></div>)}
              {dietas.length === 0 && <p className="text-xs text-[#918a7d]">Nenhum plano alimentar criado ainda.</p>}
              <div className="mt-3 space-y-2 rounded-xl bg-[#faf7ef] p-3"><p className="text-xs font-semibold text-[#4b4438]">Novo plano alimentar</p><Input value={dietaForm.titulo} onChange={(e) => setDietaForm({ ...dietaForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" /><textarea value={dietaForm.descricao} onChange={(e) => setDietaForm({ ...dietaForm, descricao: e.target.value })} placeholder="Descrição (opcional)" className="min-h-16 w-full rounded-lg border bg-white p-2 text-xs" />{dietaForm.arquivoUrl && <a href={dietaForm.arquivoUrl} target="_blank" rel="noreferrer" className="block text-[10px] font-semibold text-[#a47b13] underline">Arquivo anexado</a>}<label className={`flex h-9 w-full cursor-pointer items-center justify-center rounded-lg text-xs font-semibold text-white ${uploadingArquivo ? "bg-[#8b8579]" : "bg-[#4b4438]"}`}>{uploadingArquivo ? "Enviando..." : dietaForm.arquivoUrl ? "Trocar arquivo (opcional)" : "Anexar arquivo (opcional, até 3MB)"}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={uploadingArquivo} className="hidden" onChange={(e) => handleDietaArquivo(e.target.files?.[0])} /></label><Button onClick={() => createDieta.mutate({ alunoId, titulo: dietaForm.titulo, descricao: dietaForm.descricao || undefined, arquivoUrl: dietaForm.arquivoUrl || undefined })} disabled={!dietaForm.titulo} className="h-9 w-full rounded-lg bg-[#15130f] text-xs text-white"><Plus size={14} /> Criar rascunho</Button></div>
            </CardContent></Card>

            {selectedDieta && <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm"><CardHeader><CardTitle className="text-sm text-[#2b271f]">{selectedDieta.titulo}</CardTitle><p className="text-[10px] text-[#9b9488]">{selectedDieta.estado_publicacao} · versão {selectedDieta.versao}</p></CardHeader><CardContent className="space-y-3">
              <Input value={dietaForm.titulo} onChange={(e) => setDietaForm({ ...dietaForm, titulo: e.target.value })} placeholder="Título" className="h-9 rounded-lg text-xs" />
              <textarea value={dietaForm.descricao} onChange={(e) => setDietaForm({ ...dietaForm, descricao: e.target.value })} placeholder="Descrição" className="min-h-24 w-full rounded-lg border bg-white p-2 text-xs" />
              {dietaForm.arquivoUrl && <a href={dietaForm.arquivoUrl} target="_blank" rel="noreferrer" className="block text-[10px] font-semibold text-[#a47b13] underline">Arquivo anexado</a>}
              <label className={`flex h-9 w-full cursor-pointer items-center justify-center rounded-lg text-xs font-semibold text-white ${uploadingArquivo ? "bg-[#8b8579]" : "bg-[#4b4438]"}`}>{uploadingArquivo ? "Enviando..." : dietaForm.arquivoUrl ? "Trocar arquivo" : "Anexar arquivo (até 3MB)"}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={uploadingArquivo} className="hidden" onChange={(e) => handleDietaArquivo(e.target.files?.[0])} /></label>
              <div className="flex gap-2"><Button variant="outline" onClick={saveDietaHeader} className="h-9 flex-1 rounded-lg text-xs"><Save size={14} /> Salvar</Button><Button onClick={() => publishDieta.mutate({ id: selectedDieta.id })} disabled={publishDieta.isPending} className="h-9 flex-1 rounded-lg bg-[#15130f] text-xs text-white"><Send size={14} /> Publicar</Button></div>
            </CardContent></Card>}
          </div>}
        </>}
      </div>
    </div>
  </div>;
}

export default ProfessionalDashboard;
