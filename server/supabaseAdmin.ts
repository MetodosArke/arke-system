import { createHash, randomUUID } from "node:crypto";
import { ENV } from "./_core/env";

type Row = Record<string, unknown>;

function config() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return { url: url.replace(/\/$/, ""), key };
}

async function request<T>(table: string, init: RequestInit = {}, query = "") {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : []) as T;
}

const id = () => randomUUID();

export type AppUser = { id: string; name: string; email: string; username: string; module: string; role: string; status: string; logoUrl?: string | null; profile_data?: Record<string, string> | null; created_at: string; updated_at: string };
export type AppStudent = { id: string; name: string; academy: string; plan: string; status: string; created_at: string; updated_at: string };

export async function authenticateSupabaseAccessToken(accessToken: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Supabase access token inválido");
  return response.json() as Promise<{ id: string; email?: string; user_metadata?: Record<string, unknown> }>;
}

export async function updateSupabaseUserPassword(accessToken: string, password: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/user`, { method: "PUT", headers: { apikey: key, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  if (!response.ok) throw new Error("Não foi possível definir a nova senha. O link pode ter expirado — solicite a recuperação novamente.");
  return response.json() as Promise<{ id: string; email?: string; user_metadata?: Record<string, unknown> }>;
}

export async function findAppUserByEmail(email: string) {
  const rows = await request<AppUser[]>("app_users", {}, `?select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
  return rows[0] ?? null;
}

export async function signInWithSupabase(email: string, password: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password }) });
  if (!response.ok) throw new Error("Usuário ou senha inválidos.");
  const data = await response.json() as { access_token: string; refresh_token: string; user: { id: string; email?: string; user_metadata?: Record<string, unknown> } };
  const appUsers = await request<AppUser[]>("app_users", {}, `?select=*&email=eq.${encodeURIComponent(normalizeEmail(email))}&limit=1`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user, appUser: appUsers[0] ?? null };
}

export async function createSupabaseAuthUser(email: string, name: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "invite", email: normalizeEmail(email), data: { name } }) });
  if (!response.ok) throw new Error(`Falha ao gerar convite Supabase: ${await response.text()}`);
  return response.json() as Promise<{ action_link?: string; user?: { id: string; email?: string } }>;
}

export async function listAppUsers() { return request<AppUser[]>("app_users", {}, "?select=*&order=created_at.asc"); }
export async function createAppUser(input: Omit<AppUser, "id" | "created_at" | "updated_at">) { const authInvite = await createSupabaseAuthUser(input.email, input.name); const rows = await request<AppUser[]>("app_users", { method: "POST", body: JSON.stringify({ id: id(), ...input }) }); await sendInviteEmail(input.email, input.name, input.username, authInvite.action_link); await notifyAdmins("Novo cadastro no Arke", `<p>O cliente <strong>${input.name}</strong> foi cadastrado no módulo ${input.module}.</p><p>Usuário: ${input.username}</p>`); return rows[0]; }
export async function updateAppUser(idValue: string, input: Partial<Omit<AppUser, "id" | "created_at" | "updated_at">>) { const rows = await request<AppUser[]>("app_users", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`); await notifyAdmins("Cadastro atualizado no Arke", `<p>O cadastro <strong>${input.name ?? idValue}</strong> foi atualizado pela administração.</p>`); return rows[0]; }
export async function deleteAppUser(idValue: string) { await request("app_users", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); await notifyAdmins("Cadastro removido no Arke", `<p>O cadastro de usuário <strong>${idValue}</strong> foi removido pela administração.</p>`); return { id: idValue }; }

export async function listAppStudents() { return request<AppStudent[]>("app_students", {}, "?select=*&order=created_at.asc"); }
export async function createAppStudent(input: Omit<AppStudent, "id" | "created_at" | "updated_at">) { const rows = await request<AppStudent[]>("app_students", { method: "POST", body: JSON.stringify({ id: id(), ...input }) }); return rows[0]; }
export async function updateAppStudent(idValue: string, input: Partial<Omit<AppStudent, "id" | "created_at" | "updated_at">>) { const rows = await request<AppStudent[]>("app_students", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteAppStudent(idValue: string) { await request("app_students", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function createPasswordRecoveryCode(email: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "recovery", email: normalizeEmail(email) }) });
  if (!response.ok) return { sent: true }; // não revela se o e-mail existe
  const data = await response.json() as { email_otp?: string; token?: string };
  const code = data.email_otp ?? data.token;
  if (code) await sendEmail(normalizeEmail(email), "Recuperação de senha — Arke", `<p>Recebemos uma solicitação de recuperação de senha.</p><p>Use este código no portal Arke para definir uma nova senha:</p><h2>${code}</h2><p>Este código expira em 1 hora e só pode ser usado uma vez. Se você não fez essa solicitação, ignore este e-mail.</p>`);
  return { sent: true };
}

export async function verifyPasswordRecoveryCode(email: string, code: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/verify`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ type: "recovery", email: normalizeEmail(email), token: code }) });
  if (!response.ok) throw new Error("Código inválido ou expirado. Solicite um novo.");
  return response.json() as Promise<{ access_token: string; refresh_token: string; user: { id: string; email?: string; user_metadata?: Record<string, unknown> } }>;
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { simulated: true };
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL ?? "Arke <onboarding@resend.dev>", to: [to], subject, html }) });
  if (!response.ok) throw new Error(`Falha no envio de e-mail: ${await response.text()}`);
  return { simulated: false };
}

async function sendInviteEmail(to: string, name: string, username: string, actionLink?: string) {
  return sendEmail(to, "Convite para acessar o Arke", `<p>Olá, ${name}.</p><p>Seu acesso ao Arke foi criado.</p><p>Usuário: <strong>${username}</strong></p>${actionLink ? `<p><a href="${actionLink}">Aceitar convite e definir senha</a></p>` : ""}`);
}

async function notifyAdmins(subject: string, html: string) {
  const recipients = ["andre.alvesman@gmail.com", "comercial@metodosarke.com.br"];
  await Promise.allSettled(recipients.map((email) => sendEmail(email, subject, `<p>Olá, equipe Arke.</p>${html}<p>Mensagem automática do painel administrativo.</p>`)));
}

export function hasSupabaseConfig() { return Boolean((process.env.SUPABASE_URL ?? "") && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "")); }
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const ENV_REFERENCE = ENV.isProduction;


export type GlobalLibraryExercise = {
  id: string; nome: string; grupo_muscular: string; descricao?: string | null; instrucoes?: string | null; video_url?: string | null; imagem_url?: string | null; equipamento?: string | null; created_at: string; updated_at?: string | null;
};
export type GlobalLibraryGroup = { id: string; nome: string; ordem: number; created_at: string };
export type GlobalLibraryTemplate = { id: string; titulo: string; categoria: string; descricao?: string | null; divisoes: string[]; created_at: string; updated_at?: string | null };
export type GlobalTemplateExercise = { id: string; template_id: string; divisao: string; exercicio_id: string; ordem: number; series: number; repeticoes: string; descanso_seg: number; descanso_por_serie?: string | null; observacoes?: string | null; created_at: string };
export type GlobalNutritionPlan = { id: string; titulo: string; categoria: string; objetivo?: string | null; descricao?: string | null; instrucoes?: string | null; created_at: string; updated_at?: string | null };
export type GlobalRoutine = { id: string; titulo: string; categoria: string; descricao?: string | null; rotina: string; created_at: string; updated_at?: string | null };
export type GlobalAccessRule = { id: string; modulo: string; plano: string; habilitado: boolean; requer_consultoria: boolean; created_at: string; updated_at: string };

export async function listGlobalLibrary() {
  const [exercises, groups, templates, templateExercises, nutritionPlans, routines, accessRules] = await Promise.all([
    request<GlobalLibraryExercise[]>("exercicios", {}, "?select=*&order=created_at.desc"),
    request<GlobalLibraryGroup[]>("grupos_musculares", {}, "?select=*&order=ordem.asc,nome.asc"),
    request<GlobalLibraryTemplate[]>("treino_templates", {}, "?select=*&order=created_at.desc"),
    request<GlobalTemplateExercise[]>("treino_template_exercicios", {}, "?select=*&order=divisao.asc,ordem.asc"),
    request<GlobalNutritionPlan[]>("acervo_planos_alimentares", {}, "?select=*&order=created_at.desc"),
    request<GlobalRoutine[]>("acervo_rotinas", {}, "?select=*&order=created_at.desc"),
    request<GlobalAccessRule[]>("acervo_acesso_regras", {}, "?select=*&order=modulo.asc,plano.asc"),
  ]);
  return { exercises, groups, templates, templateExercises, nutritionPlans, routines, accessRules };
}

export async function createGlobalExercise(input: Record<string, unknown>) { const rows = await request<GlobalLibraryExercise[]>("exercicios", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalExercise(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalLibraryExercise[]>("exercicios", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalExercise(idValue: string) { await request("exercicios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function createGlobalGroup(input: Record<string, unknown>) { const rows = await request<GlobalLibraryGroup[]>("grupos_musculares", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalGroup(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalLibraryGroup[]>("grupos_musculares", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalGroup(idValue: string) { await request("grupos_musculares", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function createGlobalTemplate(input: Record<string, unknown>) { const rows = await request<GlobalLibraryTemplate[]>("treino_templates", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalTemplate(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalLibraryTemplate[]>("treino_templates", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalTemplate(idValue: string) { await request("treino_templates", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function createGlobalTemplateExercise(input: Record<string, unknown>) { const rows = await request<GlobalTemplateExercise[]>("treino_template_exercicios", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalTemplateExercise(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalTemplateExercise[]>("treino_template_exercicios", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalTemplateExercise(idValue: string) { await request("treino_template_exercicios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function createGlobalNutritionPlan(input: Record<string, unknown>) { const rows = await request<GlobalNutritionPlan[]>("acervo_planos_alimentares", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalNutritionPlan(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalNutritionPlan[]>("acervo_planos_alimentares", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalNutritionPlan(idValue: string) { await request("acervo_planos_alimentares", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function createGlobalRoutine(input: Record<string, unknown>) { const rows = await request<GlobalRoutine[]>("acervo_rotinas", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalRoutine(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalRoutine[]>("acervo_rotinas", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalRoutine(idValue: string) { await request("acervo_rotinas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function upsertGlobalAccessRule(input: Record<string, unknown>) { const rows = await request<GlobalAccessRule[]>("acervo_acesso_regras", { method: "POST", body: JSON.stringify(input), headers: { Prefer: "resolution=merge-duplicates,return=representation" } }); return rows[0]; }
export async function deleteGlobalAccessRule(idValue: string) { await request("acervo_acesso_regras", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export type StudentProfile = { user_id: string; full_name: string | null; organization_id: string | null; status: string };
export type Treino = { id: string; aluno_id: string; titulo: string; descricao?: string | null; tipo: string; status: string; estado_publicacao: "rascunho" | "publicado" | "arquivado"; versao: number; organization_id: string | null; criado_por?: string | null; publicado_por?: string | null; publicado_em?: string | null; created_at: string; updated_at: string };
export type TreinoExercicio = { id: string; treino_id: string; exercicio_id: string; ordem: number; series: number; repeticoes: string; descanso_seg: number; descanso_por_serie?: string | null; observacoes?: string | null };
export type Dieta = { id: string; aluno_id: string; titulo: string; descricao?: string | null; arquivo_url?: string | null; estado_publicacao: "rascunho" | "publicado" | "arquivado"; versao: number; organization_id: string | null; criado_por?: string | null; publicado_por?: string | null; publicado_em?: string | null; created_at: string; updated_at: string };

export async function getProfileByUserId(userId: string) { const rows = await request<StudentProfile[]>("profiles", {}, `?select=user_id,full_name,organization_id,status&user_id=eq.${encodeURIComponent(userId)}&limit=1`); return rows[0] ?? null; }
export async function listStudentsInOrganization(organizationId: string) { return request<StudentProfile[]>("profiles", {}, `?select=user_id,full_name,organization_id,status&organization_id=eq.${encodeURIComponent(organizationId)}&order=full_name.asc`); }
export async function listExercisesCatalog() { return request<GlobalLibraryExercise[]>("exercicios", {}, "?select=id,nome,grupo_muscular&order=nome.asc"); }

export async function listTreinosForAluno(alunoId: string, publishedOnly = false) { return request<Treino[]>("treinos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}${publishedOnly ? "&estado_publicacao=eq.publicado" : ""}&order=created_at.desc`); }
export async function getTreino(idValue: string) { const rows = await request<Treino[]>("treinos", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`); return rows[0] ?? null; }
export async function createTreino(input: Record<string, unknown>) { const rows = await request<Treino[]>("treinos", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateTreino(idValue: string, input: Record<string, unknown>) { const rows = await request<Treino[]>("treinos", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteTreino(idValue: string) { await request("treinos", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function listTreinoExercicios(treinoId: string) { return request<TreinoExercicio[]>("treino_exercicios", {}, `?select=*&treino_id=eq.${encodeURIComponent(treinoId)}&order=ordem.asc`); }
export async function replaceTreinoExercicios(treinoId: string, items: Array<Record<string, unknown>>) {
  await request("treino_exercicios", { method: "DELETE" }, `?treino_id=eq.${encodeURIComponent(treinoId)}`);
  if (!items.length) return [];
  return request<TreinoExercicio[]>("treino_exercicios", { method: "POST", body: JSON.stringify(items.map((item, index) => ({ ...item, treino_id: treinoId, ordem: index }))) });
}

export async function publishTreino(treinoId: string, autorId: string) {
  const treino = await getTreino(treinoId);
  if (!treino) throw new Error("Treino não encontrado.");
  const exercicios = await listTreinoExercicios(treinoId);
  const versao = treino.estado_publicacao === "rascunho" ? treino.versao : treino.versao + 1;
  const publicado_em = new Date().toISOString();
  const atualizado = await updateTreino(treinoId, { estado_publicacao: "publicado", versao, publicado_por: autorId, publicado_em });
  await request("treino_revisoes", { method: "POST", body: JSON.stringify({ treino_id: treinoId, versao, conteudo: { treino, exercicios }, autor_id: autorId, organization_id: treino.organization_id }) });
  return atualizado;
}

export async function listDietasForAluno(alunoId: string, publishedOnly = false) { return request<Dieta[]>("dietas", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}${publishedOnly ? "&estado_publicacao=eq.publicado" : ""}&order=created_at.desc`); }
export async function getDieta(idValue: string) { const rows = await request<Dieta[]>("dietas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`); return rows[0] ?? null; }
export async function createDieta(input: Record<string, unknown>) { const rows = await request<Dieta[]>("dietas", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateDieta(idValue: string, input: Record<string, unknown>) { const rows = await request<Dieta[]>("dietas", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteDieta(idValue: string) { await request("dietas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function publishDieta(dietaId: string, autorId: string) {
  const dieta = await getDieta(dietaId);
  if (!dieta) throw new Error("Plano alimentar não encontrado.");
  const versao = dieta.estado_publicacao === "rascunho" ? dieta.versao : dieta.versao + 1;
  const publicado_em = new Date().toISOString();
  const atualizado = await updateDieta(dietaId, { estado_publicacao: "publicado", versao, publicado_por: autorId, publicado_em });
  await request("dieta_revisoes", { method: "POST", body: JSON.stringify({ dieta_id: dietaId, versao, conteudo: dieta, autor_id: autorId, organization_id: dieta.organization_id }) });
  return atualizado;
}

// --- Fase 3: Jornada inicial (convite de aluno, cadastro, acolhimento) ---

export type MemberInvitation = { id: string; organization_id: string; invited_by_user_id: string | null; email: string; full_name: string; token_hash: string; status: "pending" | "accepted" | "expired" | "revoked"; expires_at: string; created_at: string; lembrete_enviado_em?: string | null };
export type Acolhimento = { id: string; aluno_id: string; rotina_diaria?: string | null; experiencias_exercicio?: string | null; experiencias_gostou?: string | null; experiencias_nao_gostou?: string | null; dores_lesoes?: string | null; medicamentos?: string | null; tempo_disponivel?: string | null; estilo_treino?: string | null; exercicios_nao_gosta?: string | null; alimentos_gosta?: string | null; alimentos_nao_gosta?: string | null; alimentacao_rotina?: string | null; created_at: string; updated_at: string };

async function getOrganizationName(organizationId: string) {
  const rows = await request<{ id: string; name: string }[]>("saas_organizations", {}, `?select=id,name&id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0]?.name ?? "sua academia";
}

export async function findPendingMemberInvitation(organizationId: string, email: string) {
  const rows = await request<MemberInvitation[]>("member_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&email=eq.${encodeURIComponent(normalizeEmail(email))}&status=eq.pending&limit=1`);
  return rows[0] ?? null;
}

export async function listPendingMemberInvitations(organizationId: string) {
  return request<MemberInvitation[]>("member_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending&order=created_at.desc`);
}

export async function inviteMember(input: { organizationId: string; invitedByUserId: string; email: string; fullName: string }) {
  const email = normalizeEmail(input.email);
  const existing = await findPendingMemberInvitation(input.organizationId, email);
  if (existing) throw new Error("Já existe um convite pendente para este e-mail nesta organização.");

  const rawToken = randomUUID();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  const rows = await request<MemberInvitation[]>("member_invitations", { method: "POST", body: JSON.stringify({
    organization_id: input.organizationId,
    invited_by_user_id: input.invitedByUserId,
    email,
    full_name: input.fullName,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  }) });
  const invitation = rows[0];

  const orgName = await getOrganizationName(input.organizationId);
  await sendEmail(email, `Convite para o Arke — ${orgName}`, `<p>Olá, ${input.fullName}.</p><p>Você foi convidado(a) a fazer parte de <strong>${orgName}</strong> no Arke.</p><p>Para concluir seu cadastro, acesse o portal, clique em "Tenho um convite" na tela de login e use o código abaixo:</p><h2 style="letter-spacing:1px">${rawToken}</h2><p>Este convite expira em 7 dias.</p>`);
  return invitation;
}

export async function revokeMemberInvitation(id: string, organizationId: string) {
  const rows = await request<MemberInvitation[]>("member_invitations", { method: "PATCH", body: JSON.stringify({ status: "revoked" }) }, `?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Convite não encontrado ou já utilizado.");
  return rows[0];
}

async function findMemberInvitationByToken(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await request<MemberInvitation[]>("member_invitations", {}, `?select=*&token_hash=eq.${encodeURIComponent(tokenHash)}&status=eq.pending&limit=1`);
  return rows[0] ?? null;
}

async function createSupabaseUserWithPassword(email: string, password: string, fullName: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password, email_confirm: true, user_metadata: { full_name: fullName } }) });
  if (!response.ok) throw new Error("Não foi possível criar sua conta. Verifique se este e-mail já não está cadastrado.");
  return response.json() as Promise<{ id: string; email?: string }>;
}

export async function acceptMemberInvitation(token: string, password: string) {
  const invitation = await findMemberInvitationByToken(token);
  if (!invitation) throw new Error("Código de convite inválido ou já utilizado.");
  if (new Date(invitation.expires_at).getTime() < Date.now()) throw new Error("Este convite expirou. Peça para reenviarem o convite.");

  const authUser = await createSupabaseUserWithPassword(invitation.email, password, invitation.full_name);

  // O gatilho on_auth_user_created (Supabase) já cria a linha em profiles
  // com organization_id nulo; aqui só vinculamos à organização do convite.
  await request("profiles", { method: "PATCH", body: JSON.stringify({ full_name: invitation.full_name, organization_id: invitation.organization_id, status: "active" }) }, `?user_id=eq.${encodeURIComponent(authUser.id)}`);

  const accepted = await request<MemberInvitation[]>("member_invitations", { method: "PATCH", body: JSON.stringify({ status: "accepted" }) }, `?id=eq.${encodeURIComponent(invitation.id)}&status=eq.pending`);
  if (!accepted[0]) throw new Error("Este convite já foi utilizado.");

  const session = await signInWithSupabase(invitation.email, password);
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user, organizationId: invitation.organization_id };
}

export async function getAcolhimento(alunoId: string) {
  const rows = await request<Acolhimento[]>("reuniao_acolhimento", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&limit=1`);
  return rows[0] ?? null;
}

export async function upsertAcolhimento(alunoId: string, data: Record<string, unknown>) {
  const rows = await request<Acolhimento[]>("reuniao_acolhimento", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ ...data, aluno_id: alunoId, criado_por: alunoId, updated_at: new Date().toISOString() }) }, "?on_conflict=aluno_id");
  return rows[0];
}

// --- Fase 6: Acompanhamento (check-in e central de atendimento) ---

export type CheckIn = { id: string; aluno_id: string; organization_id: string; status: "indo_bem" | "com_dificuldade" | "quero_ajuda"; observacao?: string | null; created_at: string };
export type Atendimento = { id: string; organization_id: string; aluno_id: string; origem: "check_in" | "pedido_direto" | "manual" | "sem_checkin"; origem_check_in_id?: string | null; prioridade: "rotina" | "atencao" | "prioritario" | "encaminhamento_profissional"; descricao?: string | null; status: "aberta" | "em_andamento" | "resolvida"; responsavel_id?: string | null; prazo?: string | null; resultado?: string | null; resolvido_por?: string | null; resolvido_em?: string | null; criado_por?: string | null; escalonamentos_count: number; created_at: string; updated_at: string };

const CHECKIN_PRIORIDADE: Record<"com_dificuldade" | "quero_ajuda", Atendimento["prioridade"]> = {
  com_dificuldade: "atencao",
  quero_ajuda: "prioritario",
};

export async function createCheckIn(input: { alunoId: string; organizationId: string; status: CheckIn["status"]; observacao?: string }) {
  const rows = await request<CheckIn[]>("check_ins", { method: "POST", body: JSON.stringify({ aluno_id: input.alunoId, organization_id: input.organizationId, status: input.status, observacao: input.observacao || undefined }) });
  return rows[0];
}

export async function listMyCheckIns(alunoId: string) {
  return request<CheckIn[]>("check_ins", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=created_at.desc&limit=20`);
}

async function findOpenAtendimento(alunoId: string, origem: Atendimento["origem"]) {
  const rows = await request<Atendimento[]>("atendimentos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&origem=eq.${origem}&status=in.(aberta,em_andamento)&limit=1`);
  return rows[0] ?? null;
}

export async function createAtendimento(input: { organizationId: string; alunoId: string; origem: Atendimento["origem"]; origemCheckInId?: string; prioridade: Atendimento["prioridade"]; descricao?: string; criadoPor?: string; prazo?: string }) {
  const rows = await request<Atendimento[]>("atendimentos", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, aluno_id: input.alunoId, origem: input.origem, origem_check_in_id: input.origemCheckInId || undefined, prioridade: input.prioridade, descricao: input.descricao || undefined, criado_por: input.criadoPor || undefined, prazo: input.prazo || undefined }) });
  return rows[0];
}

export async function submitCheckIn(input: { alunoId: string; organizationId: string; status: CheckIn["status"]; observacao?: string }) {
  const checkIn = await createCheckIn(input);
  if (input.status !== "indo_bem") {
    const existing = await findOpenAtendimento(input.alunoId, "check_in");
    if (!existing) await createAtendimento({ organizationId: input.organizationId, alunoId: input.alunoId, origem: "check_in", origemCheckInId: checkIn.id, prioridade: CHECKIN_PRIORIDADE[input.status], descricao: input.observacao });
  }
  return checkIn;
}

export async function requestHelp(input: { alunoId: string; organizationId: string; descricao?: string }) {
  const existing = await findOpenAtendimento(input.alunoId, "pedido_direto");
  if (existing) return existing;
  return createAtendimento({ organizationId: input.organizationId, alunoId: input.alunoId, origem: "pedido_direto", prioridade: "prioritario", descricao: input.descricao, criadoPor: input.alunoId });
}

export async function listMyAtendimentos(alunoId: string) {
  return request<Atendimento[]>("atendimentos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=created_at.desc&limit=20`);
}

export async function listAtendimentosForOrganization(organizationId: string, status?: Atendimento["status"]) {
  return request<Atendimento[]>("atendimentos", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${status ? `&status=eq.${status}` : ""}&order=created_at.asc`);
}

export async function getAtendimento(idValue: string) {
  const rows = await request<Atendimento[]>("atendimentos", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}

export async function assignAtendimento(idValue: string, responsavelId: string) {
  const rows = await request<Atendimento[]>("atendimentos", { method: "PATCH", body: JSON.stringify({ responsavel_id: responsavelId, status: "em_andamento" }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}

export async function resolveAtendimento(idValue: string, resolvidoPor: string, resultado: string) {
  const rows = await request<Atendimento[]>("atendimentos", { method: "PATCH", body: JSON.stringify({ status: "resolvida", resultado, resolvido_por: resolvidoPor, resolvido_em: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}

// --- Fase 7: Automação (escalonamento, lembretes, sem duplicação) ---
//
// Cada regra abaixo declara evento de origem, condições, ação,
// prioridade, responsável, prazo, limite de repetição e condição de
// encerramento (CLAUDE.md §6), só que como código — não como linhas
// configuráveis por um painel, que fica para uma etapa futura.

const PRIORIDADE_ORDEM: Atendimento["prioridade"][] = ["rotina", "atencao", "prioritario", "encaminhamento_profissional"];
const MAX_ESCALONAMENTOS = 3;
const PRAZO_APOS_ESCALONAMENTO_MS = 1000 * 60 * 60 * 24 * 2;
const DIAS_SEM_CHECKIN = 7;
const DIAS_CONVITE_PENDENTE = 3;

// Regra 1 — evento: prazo de um atendimento aberto/em andamento vence.
// condição: ainda não atingiu o limite de repetição (3 escalonamentos).
// ação: sobe um nível de prioridade e dá um novo prazo.
// condição de encerramento: a tarefa é resolvida (para de aparecer aqui).
export async function listAtendimentosVencidos() {
  const now = new Date().toISOString();
  return request<Atendimento[]>("atendimentos", {}, `?select=*&status=in.(aberta,em_andamento)&prazo=lt.${encodeURIComponent(now)}&escalonamentos_count=lt.${MAX_ESCALONAMENTOS}`);
}

export async function escalateAtendimento(atendimento: Atendimento) {
  const proximoIndex = Math.min(PRIORIDADE_ORDEM.indexOf(atendimento.prioridade) + 1, PRIORIDADE_ORDEM.length - 1);
  const rows = await request<Atendimento[]>("atendimentos", { method: "PATCH", body: JSON.stringify({
    prioridade: PRIORIDADE_ORDEM[proximoIndex],
    escalonamentos_count: atendimento.escalonamentos_count + 1,
    prazo: new Date(Date.now() + PRAZO_APOS_ESCALONAMENTO_MS).toISOString(),
  }) }, `?id=eq.${encodeURIComponent(atendimento.id)}`);
  return rows[0];
}

// Regra 2 — evento: nenhum check-in registrado nos últimos N dias.
// condição: aluno ativo (uma pausa — status diferente de "active" —
// interrompe esta regra) e vinculado a uma organização.
// ação: cria um atendimento de prioridade "rotina" com um texto neutro
// (nunca afirma que o aluno não treinou — só que não há check-in).
// limite de repetição / encerramento: o índice único de atendimentos
// (aluno_id, origem) já impede duplicar enquanto a tarefa não é
// resolvida (CLAUDE.md §6).
type ProfileActivity = { user_id: string; organization_id: string; created_at: string };

export async function listAlunosSemCheckIn(dias = DIAS_SEM_CHECKIN) {
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const candidatos = await request<ProfileActivity[]>("profiles", {}, `?select=user_id,organization_id,created_at&status=eq.active&organization_id=not.is.null&created_at=lt.${encodeURIComponent(cutoff)}`);
  if (!candidatos.length) return [];
  const ids = candidatos.map((c) => c.user_id).join(",");
  const recentes = await request<{ aluno_id: string }[]>("check_ins", {}, `?select=aluno_id&aluno_id=in.(${ids})&created_at=gte.${encodeURIComponent(cutoff)}`);
  const comCheckInRecente = new Set(recentes.map((r) => r.aluno_id));
  return candidatos.filter((c) => !comCheckInRecente.has(c.user_id));
}

export async function createSemCheckInAtendimentoIfNeeded(alunoId: string, organizationId: string, dias: number) {
  try {
    return await createAtendimento({ organizationId, alunoId, origem: "sem_checkin", prioridade: "rotina", descricao: `Sem registro de check-in há mais de ${dias} dias.` });
  } catch {
    return null; // já existe uma tarefa aberta da mesma origem para este aluno — nunca duplicar.
  }
}

// Regra 3 — evento: convite de aluno pendente há mais de N dias.
// condição: ainda não expirou e nenhum lembrete foi enviado antes.
// ação: gera um novo código, estende o prazo e reenvia o e-mail.
// limite de repetição: 1 (lembrete_enviado_em marca que já foi usado).
export async function listInvitationsForReminder(dias = DIAS_CONVITE_PENDENTE) {
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  return request<MemberInvitation[]>("member_invitations", {}, `?select=*&status=eq.pending&lembrete_enviado_em=is.null&created_at=lt.${encodeURIComponent(cutoff)}&expires_at=gt.${encodeURIComponent(now)}`);
}

export async function resendInvitationReminder(invitation: MemberInvitation) {
  const rawToken = randomUUID();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await request("member_invitations", { method: "PATCH", body: JSON.stringify({ token_hash: tokenHash, expires_at: expiresAt, lembrete_enviado_em: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(invitation.id)}`);
  const orgName = await getOrganizationName(invitation.organization_id);
  await sendEmail(invitation.email, `Lembrete: convite para o Arke — ${orgName}`, `<p>Olá, ${invitation.full_name}.</p><p>Você ainda não concluiu seu cadastro em <strong>${orgName}</strong> no Arke.</p><p>Acesse o portal, clique em "Tenho um convite" na tela de login e use o novo código abaixo:</p><h2 style="letter-spacing:1px">${rawToken}</h2><p>Este convite expira em 7 dias.</p>`);
}

export type AutomacaoResultado = { tarefasEscaladas: number; lembretesCheckIn: number; lembretesConvite: number; erros: string[] };

export async function runAutomacaoDiaria(): Promise<AutomacaoResultado> {
  const resultado: AutomacaoResultado = { tarefasEscaladas: 0, lembretesCheckIn: 0, lembretesConvite: 0, erros: [] };

  try {
    for (const atendimento of await listAtendimentosVencidos()) {
      try {
        await escalateAtendimento(atendimento);
        resultado.tarefasEscaladas += 1;
      } catch (error) {
        resultado.erros.push(`escalonamento ${atendimento.id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    resultado.erros.push(`listar tarefas vencidas: ${(error as Error).message}`);
  }

  try {
    for (const perfil of await listAlunosSemCheckIn()) {
      try {
        if (await createSemCheckInAtendimentoIfNeeded(perfil.user_id, perfil.organization_id, DIAS_SEM_CHECKIN)) resultado.lembretesCheckIn += 1;
      } catch (error) {
        resultado.erros.push(`sem-checkin ${perfil.user_id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    resultado.erros.push(`listar alunos sem check-in: ${(error as Error).message}`);
  }

  try {
    for (const invitation of await listInvitationsForReminder()) {
      try {
        await resendInvitationReminder(invitation);
        resultado.lembretesConvite += 1;
      } catch (error) {
        resultado.erros.push(`lembrete convite ${invitation.id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    resultado.erros.push(`listar convites pendentes: ${(error as Error).message}`);
  }

  return resultado;
}

// --- Fase 8: Gestão (prazos, capacidade, indicadores) ---
//
// Indicadores agregados a partir de dados que já existem — nenhuma
// tabela nova. Fica só no nível da organização (não por profissional):
// não há um relacionamento real de "aluno atribuído a profissional"
// no modelo hoje, então inventar essa quebra seria fingir uma análise
// que não foi feita (CLAUDE.md "princípio central").

export type GestaoIndicadores = {
  capacidade: { totalAlunos: number; totalStaff: number; mediaAlunosPorStaff: number | null };
  entrega: {
    treino: { semRegistro: number; rascunho: number; publicado: number };
    dieta: { semRegistro: number; rascunho: number; publicado: number };
  };
  atendimento: {
    abertos: number;
    emAndamento: number;
    vencidos: number;
    resolvidosUltimos30Dias: number;
    tempoMedioResolucaoHoras: number | null;
    porPrioridade: Record<Atendimento["prioridade"], number>;
  };
};

function resumoEntrega(alunoIds: Set<string>, registros: Array<{ aluno_id: string; estado_publicacao: string }>) {
  const temRegistro = new Set<string>();
  const temPublicado = new Set<string>();
  for (const registro of registros) {
    if (!alunoIds.has(registro.aluno_id)) continue;
    temRegistro.add(registro.aluno_id);
    if (registro.estado_publicacao === "publicado") temPublicado.add(registro.aluno_id);
  }
  return { semRegistro: alunoIds.size - temRegistro.size, rascunho: temRegistro.size - temPublicado.size, publicado: temPublicado.size };
}

export async function getGestaoIndicadores(organizationId: string): Promise<GestaoIndicadores> {
  const trintaDiasAtras = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();

  const [alunos, staff, treinos, dietas, abertos, resolvidosRecentes] = await Promise.all([
    request<{ user_id: string }[]>("profiles", {}, `?select=user_id&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request<{ id: string }[]>("saas_memberships", {}, `?select=id&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request<{ aluno_id: string; estado_publicacao: string }[]>("treinos", {}, `?select=aluno_id,estado_publicacao&organization_id=eq.${encodeURIComponent(organizationId)}`),
    request<{ aluno_id: string; estado_publicacao: string }[]>("dietas", {}, `?select=aluno_id,estado_publicacao&organization_id=eq.${encodeURIComponent(organizationId)}`),
    request<{ status: Atendimento["status"]; prioridade: Atendimento["prioridade"]; prazo: string | null }[]>("atendimentos", {}, `?select=status,prioridade,prazo&organization_id=eq.${encodeURIComponent(organizationId)}&status=in.(aberta,em_andamento)`),
    request<{ created_at: string; resolvido_em: string | null }[]>("atendimentos", {}, `?select=created_at,resolvido_em&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.resolvida&resolvido_em=gte.${encodeURIComponent(trintaDiasAtras)}`),
  ]);

  const alunoIds = new Set(alunos.map((a) => a.user_id));
  const now = Date.now();
  const porPrioridade: GestaoIndicadores["atendimento"]["porPrioridade"] = { rotina: 0, atencao: 0, prioritario: 0, encaminhamento_profissional: 0 };
  for (const item of abertos) porPrioridade[item.prioridade] += 1;

  const temposResolucaoHoras = resolvidosRecentes.filter((item) => item.resolvido_em).map((item) => (new Date(item.resolvido_em as string).getTime() - new Date(item.created_at).getTime()) / (1000 * 60 * 60));

  return {
    capacidade: { totalAlunos: alunoIds.size, totalStaff: staff.length, mediaAlunosPorStaff: staff.length ? alunoIds.size / staff.length : null },
    entrega: { treino: resumoEntrega(alunoIds, treinos), dieta: resumoEntrega(alunoIds, dietas) },
    atendimento: {
      abertos: abertos.filter((item) => item.status === "aberta").length,
      emAndamento: abertos.filter((item) => item.status === "em_andamento").length,
      vencidos: abertos.filter((item) => item.prazo && new Date(item.prazo).getTime() < now).length,
      resolvidosUltimos30Dias: resolvidosRecentes.length,
      tempoMedioResolucaoHoras: temposResolucaoHoras.length ? temposResolucaoHoras.reduce((sum, horas) => sum + horas, 0) / temposResolucaoHoras.length : null,
      porPrioridade,
    },
  };
}
