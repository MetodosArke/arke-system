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
export async function deleteAppUser(idValue: string) {
  // saas_organizations.client_id -> app_users(id) é ON DELETE RESTRICT (o
  // cliente é o "pai" da organização, nunca deve desaparecer sozinho por
  // engano). Para excluir o cadastro por completo (ex.: recomeçar o
  // onboarding do zero), a organização e tudo que depende dela via
  // organization_id (unidades, memberships, assinatura, leads,
  // atendimentos, integrações etc. — todas já com ON DELETE CASCADE)
  // precisam ser removidas primeiro.
  await request("saas_organizations", { method: "DELETE" }, `?client_id=eq.${encodeURIComponent(idValue)}`);
  await request("app_users", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  await notifyAdmins("Cadastro removido no Arke", `<p>O cadastro de usuário <strong>${idValue}</strong> foi removido pela administração, junto com qualquer organização vinculada.</p>`);
  return { id: idValue };
}

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
  if (!apiKey) {
    // Em produção, uma chave ausente não pode virar sucesso silencioso —
    // quem convida um aluno/colega de equipe precisa saber que o e-mail
    // não foi enviado, não receber um "convite enviado" falso. Em
    // desenvolvimento local sem a chave configurada, mantém a simulação.
    if (ENV.isProduction) throw new Error("RESEND_API_KEY não configurada — não é possível enviar e-mail em produção.");
    return { simulated: true };
  }
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


export type EstadoPublicacaoAcervo = "rascunho" | "publicado" | "arquivado";

export type GlobalLibraryExercise = {
  id: string; nome: string; grupo_muscular: string; descricao?: string | null; instrucoes?: string | null; video_url?: string | null; imagem_url?: string | null; equipamento?: string | null; estado_publicacao: EstadoPublicacaoAcervo; publicado_por?: string | null; publicado_em?: string | null; created_at: string; updated_at?: string | null;
};
export type GlobalLibraryGroup = { id: string; nome: string; ordem: number; created_at: string };
export type GlobalLibraryTemplate = { id: string; titulo: string; categoria: string; descricao?: string | null; divisoes: string[]; estado_publicacao: EstadoPublicacaoAcervo; publicado_por?: string | null; publicado_em?: string | null; created_at: string; updated_at?: string | null };
export type GlobalTemplateExercise = { id: string; template_id: string; divisao: string; exercicio_id: string; ordem: number; series: number; repeticoes: string; descanso_seg: number; descanso_por_serie?: string | null; observacoes?: string | null; created_at: string };
export type GlobalNutritionPlan = { id: string; titulo: string; categoria: string; objetivo?: string | null; descricao?: string | null; instrucoes?: string | null; estado_publicacao: EstadoPublicacaoAcervo; publicado_por?: string | null; publicado_em?: string | null; created_at: string; updated_at?: string | null };
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

// Aprovação em lote de rascunhos gerados por IA (scripts/seed-acervo.ts):
// o Admin Arke revisa e decide publicar — a IA nunca publica nada sozinha.
const inFilter = (ids: string[]) => `id=in.(${ids.map(encodeURIComponent).join(",")})`;

export async function publishGlobalExercises(ids: string[], userId: string) {
  if (!ids.length) return [];
  return request<GlobalLibraryExercise[]>("exercicios", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: new Date().toISOString() }) }, `?${inFilter(ids)}`);
}
export async function publishGlobalTemplates(ids: string[], userId: string) {
  if (!ids.length) return [];
  return request<GlobalLibraryTemplate[]>("treino_templates", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: new Date().toISOString() }) }, `?${inFilter(ids)}`);
}
export async function publishGlobalNutritionPlans(ids: string[], userId: string) {
  if (!ids.length) return [];
  return request<GlobalNutritionPlan[]>("acervo_planos_alimentares", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: new Date().toISOString() }) }, `?${inFilter(ids)}`);
}

export async function createGlobalRoutine(input: Record<string, unknown>) { const rows = await request<GlobalRoutine[]>("acervo_rotinas", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalRoutine(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalRoutine[]>("acervo_rotinas", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalRoutine(idValue: string) { await request("acervo_rotinas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function upsertGlobalAccessRule(input: Record<string, unknown>) { const rows = await request<GlobalAccessRule[]>("acervo_acesso_regras", { method: "POST", body: JSON.stringify(input), headers: { Prefer: "resolution=merge-duplicates,return=representation" } }); return rows[0]; }
export async function deleteGlobalAccessRule(idValue: string) { await request("acervo_acesso_regras", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export type StudentProfile = { user_id: string; full_name: string | null; organization_id: string | null; status: string; unit_id?: string | null; matricula_em?: string | null };
export type Treino = { id: string; aluno_id: string; titulo: string; descricao?: string | null; tipo: string; status: string; estado_publicacao: "rascunho" | "publicado" | "arquivado"; versao: number; organization_id: string | null; criado_por?: string | null; publicado_por?: string | null; publicado_em?: string | null; created_at: string; updated_at: string };
export type TreinoExercicio = { id: string; treino_id: string; exercicio_id: string; ordem: number; series: number; repeticoes: string; descanso_seg: number; descanso_por_serie?: string | null; observacoes?: string | null };
export type Dieta = { id: string; aluno_id: string; titulo: string; descricao?: string | null; arquivo_url?: string | null; estado_publicacao: "rascunho" | "publicado" | "arquivado"; versao: number; organization_id: string | null; criado_por?: string | null; publicado_por?: string | null; publicado_em?: string | null; created_at: string; updated_at: string };

export async function getProfileByUserId(userId: string) { const rows = await request<StudentProfile[]>("profiles", {}, `?select=user_id,full_name,organization_id,status,unit_id,matricula_em&user_id=eq.${encodeURIComponent(userId)}&limit=1`); return rows[0] ?? null; }
export async function listStudentsInOrganization(organizationId: string) { return request<StudentProfile[]>("profiles", {}, `?select=user_id,full_name,organization_id,status,unit_id,matricula_em&organization_id=eq.${encodeURIComponent(organizationId)}&order=full_name.asc`); }

export async function updateStudentMatricula(alunoId: string, input: { unitId?: string | null; matriculaEm?: string | null }) {
  const body: Record<string, unknown> = {};
  if (input.unitId !== undefined) body.unit_id = input.unitId;
  if (input.matriculaEm !== undefined) body.matricula_em = input.matriculaEm;
  const rows = await request<StudentProfile[]>("profiles", { method: "PATCH", body: JSON.stringify(body) }, `?user_id=eq.${encodeURIComponent(alunoId)}`);
  return rows[0];
}

export type ArkeModule = { organization_id: string; enabled: boolean; package_tier: "starter" | "growth" | "scale" | null; amount_cents: number | null; enabled_at: string | null; last_repasse_charged_at: string | null; updated_at: string };
export type AlunoArkeLicenca = { id: string; organization_id: string; user_id: string; ativo: boolean; ativado_em: string | null; desativado_em: string | null; ativado_por: string | null; created_at: string; updated_at: string };

export async function getArkeModule(organizationId: string) { const rows = await request<ArkeModule[]>("saas_arke_module", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`); return rows[0] ?? null; }
export async function upsertArkeModule(input: { organizationId: string; enabled: boolean; packageTier?: "starter" | "growth" | "scale" | null; amountCents?: number | null }) {
  const body = { organization_id: input.organizationId, enabled: input.enabled, package_tier: input.packageTier ?? null, amount_cents: input.amountCents ?? null, enabled_at: input.enabled ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
  const rows = await request<ArkeModule[]>("saas_arke_module", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=organization_id");
  return rows[0];
}

export async function listArkeModulesEnabled() { return request<ArkeModule[]>("saas_arke_module", {}, "?select=*&enabled=eq.true"); }
export async function markArkeRepasseCharged(organizationId: string, chargedOn: string) { await request("saas_arke_module", { method: "PATCH", body: JSON.stringify({ last_repasse_charged_at: chargedOn }) }, `?organization_id=eq.${encodeURIComponent(organizationId)}`); }

export async function getAlunoArkeLicenca(userId: string, organizationId: string) { const rows = await request<AlunoArkeLicenca[]>("aluno_arke_licenca", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`); return rows[0] ?? null; }
export async function countAlunosComArkeAtivo(organizationId: string) { const rows = await request<Array<{ count: number }>>("aluno_arke_licenca", { headers: { Prefer: "count=exact" } }, `?select=id&organization_id=eq.${encodeURIComponent(organizationId)}&ativo=eq.true`); return rows.length; }
export async function toggleAlunoArkeLicenca(input: { userId: string; organizationId: string; ativo: boolean; ativadoPor: string }) {
  const now = new Date().toISOString();
  const body = { organization_id: input.organizationId, user_id: input.userId, ativo: input.ativo, ativado_em: input.ativo ? now : undefined, desativado_em: input.ativo ? undefined : now, ativado_por: input.ativadoPor, updated_at: now };
  const rows = await request<AlunoArkeLicenca[]>("aluno_arke_licenca", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=organization_id,user_id");
  return rows[0];
}

// Núcleo do método Arke (Fase 1c): check-in diário, avaliação semanal e
// plano de horários — porta o mesmo padrão upsert-on-natural-key do
// arke-app original (checkin_diario/avaliacao_semanal por user_id+data ou
// user_id+semana; plano_treino_semanal é 1 linha por aluno).
export type CheckinDiario = { id: string; user_id: string; organization_id: string; data: string; dedicacao: "baixa" | "media" | "boa" | "excelente"; created_at: string };
export async function getCheckinDoDia(userId: string, data: string) { const rows = await request<CheckinDiario[]>("checkin_diario", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&data=eq.${encodeURIComponent(data)}&limit=1`); return rows[0] ?? null; }
export async function upsertCheckinDiario(input: { userId: string; organizationId: string; data: string; dedicacao: string }) {
  const body = { user_id: input.userId, organization_id: input.organizationId, data: input.data, dedicacao: input.dedicacao };
  const rows = await request<CheckinDiario[]>("checkin_diario", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,data");
  return rows[0];
}

export type AvaliacaoSemanal = { id: string; user_id: string; organization_id: string; semana: string; sono: number; produtividade: number; humor: number; conquista: string | null; created_at: string; updated_at: string };
export async function getAvaliacaoSemanal(userId: string, semana: string) { const rows = await request<AvaliacaoSemanal[]>("avaliacao_semanal", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&semana=eq.${encodeURIComponent(semana)}&limit=1`); return rows[0] ?? null; }
export async function upsertAvaliacaoSemanal(input: { userId: string; organizationId: string; semana: string; sono: number; produtividade: number; humor: number; conquista?: string }) {
  const body = { user_id: input.userId, organization_id: input.organizationId, semana: input.semana, sono: input.sono, produtividade: input.produtividade, humor: input.humor, conquista: input.conquista ?? null, updated_at: new Date().toISOString() };
  const rows = await request<AvaliacaoSemanal[]>("avaliacao_semanal", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,semana");
  return rows[0];
}

export type PlanoTreinoSemanal = { id: string; user_id: string; organization_id: string; dias_treino: string[]; horario_preferido: string | null; local_treino: string | null; created_at: string; updated_at: string };
export async function getPlanoTreinoSemanal(userId: string) { const rows = await request<PlanoTreinoSemanal[]>("plano_treino_semanal", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`); return rows[0] ?? null; }
export async function upsertPlanoTreinoSemanal(input: { userId: string; organizationId: string; diasTreino: string[]; horarioPreferido?: string | null; localTreino?: string | null }) {
  const body = { user_id: input.userId, organization_id: input.organizationId, dias_treino: input.diasTreino, horario_preferido: input.horarioPreferido ?? null, local_treino: input.localTreino ?? null, updated_at: new Date().toISOString() };
  const rows = await request<PlanoTreinoSemanal[]>("plano_treino_semanal", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id");
  return rows[0];
}

// Evolução (progresso_semanal): cada chamada de create insere um novo
// registro histórico (não é upsert por chave natural como check-in/avaliação
// — o aluno pode registrar medidas quantas vezes o profissional quiser).
const PROGRESSO_SEMANAL_SELECT = "id,aluno_id,organization_id,data,peso_kg,gordura_percentual,musculo_percentual,cintura_cm,quadril_cm,braco_cm,perna_cm,bem_estar,observacoes,meta_peso_kg,created_at";
export type ProgressoSemanal = { id: string; aluno_id: string; organization_id: string; data: string; peso_kg: number | null; gordura_percentual: number | null; musculo_percentual: number | null; cintura_cm: number | null; quadril_cm: number | null; braco_cm: number | null; perna_cm: number | null; bem_estar: number | null; observacoes: string | null; meta_peso_kg: number | null; created_at: string };
export async function listProgressoSemanal(alunoId: string) { return request<ProgressoSemanal[]>("progresso_semanal", {}, `?select=${PROGRESSO_SEMANAL_SELECT}&aluno_id=eq.${encodeURIComponent(alunoId)}&order=data.asc`); }
export async function getProgressoSemanal(idValue: string) { const rows = await request<ProgressoSemanal[]>("progresso_semanal", {}, `?select=${PROGRESSO_SEMANAL_SELECT}&id=eq.${encodeURIComponent(idValue)}&limit=1`); return rows[0] ?? null; }
export async function createProgressoSemanal(input: Record<string, unknown>) { const rows = await request<ProgressoSemanal[]>("progresso_semanal", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function deleteProgressoSemanal(idValue: string) { await request("progresso_semanal", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

// Feed (Fase 2 — engajamento): posts, curtidas e comentários da comunidade
// da organização. Autor resolvido via profiles.full_name (staff e aluno
// compartilham a mesma tabela de perfil, então um join in-memory por
// user_id basta — sem embed do PostgREST, seguindo o padrão do resto do
// arquivo).
export type FeedPost = { id: string; user_id: string; organization_id: string; content: string; image_url: string | null; created_at: string };
export type FeedLike = { id: string; post_id: string; user_id: string; organization_id: string; created_at: string };
export type FeedComment = { id: string; post_id: string; user_id: string; organization_id: string; content: string; created_at: string };
const idsInFilter = (column: string, ids: string[]) => `${column}=in.(${ids.map(encodeURIComponent).join(",")})`;

export async function listFeedPosts(organizationId: string, limit = 50) { return request<FeedPost[]>("feed_posts", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc&limit=${limit}`); }
export async function getFeedPost(idValue: string) { const rows = await request<FeedPost[]>("feed_posts", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`); return rows[0] ?? null; }
export async function createFeedPost(input: Record<string, unknown>) { const rows = await request<FeedPost[]>("feed_posts", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function deleteFeedPost(idValue: string) { await request("feed_posts", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function listFeedLikesForPosts(postIds: string[]) { if (!postIds.length) return []; return request<FeedLike[]>("feed_likes", {}, `?select=*&${idsInFilter("post_id", postIds)}`); }
export async function getFeedLike(postId: string, userId: string) { const rows = await request<FeedLike[]>("feed_likes", {}, `?select=*&post_id=eq.${encodeURIComponent(postId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`); return rows[0] ?? null; }
export async function createFeedLike(input: { postId: string; userId: string; organizationId: string }) { const rows = await request<FeedLike[]>("feed_likes", { method: "POST", body: JSON.stringify({ post_id: input.postId, user_id: input.userId, organization_id: input.organizationId }) }); return rows[0]; }
export async function deleteFeedLike(postId: string, userId: string) { await request("feed_likes", { method: "DELETE" }, `?post_id=eq.${encodeURIComponent(postId)}&user_id=eq.${encodeURIComponent(userId)}`); return { postId, userId }; }

export async function listFeedCommentsForPosts(postIds: string[]) { if (!postIds.length) return []; return request<FeedComment[]>("feed_comments", {}, `?select=*&${idsInFilter("post_id", postIds)}&order=created_at.asc`); }
export async function getFeedComment(idValue: string) { const rows = await request<FeedComment[]>("feed_comments", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`); return rows[0] ?? null; }
export async function createFeedComment(input: Record<string, unknown>) { const rows = await request<FeedComment[]>("feed_comments", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function deleteFeedComment(idValue: string) { await request("feed_comments", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function listProfileNames(userIds: string[]) { if (!userIds.length) return []; return request<Array<{ user_id: string; full_name: string | null }>>("profiles", {}, `?select=user_id,full_name&${idsInFilter("user_id", userIds)}`); }

// Desafios (Fase 2 — engajamento): sempre criados/geridos pela equipe, o
// aluno só lê. O `tipo`/`meta_valor` reaproveita o vocabulário do arke-app
// original, mas o rastreamento automático por dieta/treino registrado
// (dieta_adesao, registro_treino, treino_calendario) ainda não existe no
// SaaS novo — por isso `desafio_progresso.valor_atual`/`concluido` são
// atualizados manualmente pela equipe aqui, nunca calculados, para não
// fingir uma análise que o sistema não fez (CLAUDE.md).
export type Desafio = { id: string; organization_id: string; titulo: string; descricao: string | null; tipo: string; meta_valor: number | null; data_inicio: string; data_fim: string; pontos: number; criado_por: string | null; para_todos: boolean; created_at: string; updated_at: string };
export type DesafioParticipante = { id: string; desafio_id: string; aluno_id: string; organization_id: string; created_at: string };
export type DesafioProgresso = { id: string; desafio_id: string; aluno_id: string; organization_id: string; concluido: boolean; valor_atual: number | null; concluido_por: string | null; concluido_em: string | null; created_at: string; updated_at: string };

export async function listDesafios(organizationId: string) { return request<Desafio[]>("desafios", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=data_fim.desc`); }
export async function getDesafio(idValue: string) { const rows = await request<Desafio[]>("desafios", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`); return rows[0] ?? null; }
export async function createDesafio(input: Record<string, unknown>) { const rows = await request<Desafio[]>("desafios", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateDesafio(idValue: string, input: Record<string, unknown>) { const rows = await request<Desafio[]>("desafios", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteDesafio(idValue: string) { await request("desafios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function listDesafioParticipantes(desafioId: string) { return request<DesafioParticipante[]>("desafio_participantes", {}, `?select=*&desafio_id=eq.${encodeURIComponent(desafioId)}`); }
export async function listDesafioParticipantesForAluno(alunoId: string) { return request<DesafioParticipante[]>("desafio_participantes", {}, `?select=desafio_id&aluno_id=eq.${encodeURIComponent(alunoId)}`); }
export async function addDesafioParticipante(input: { desafioId: string; alunoId: string; organizationId: string }) {
  const rows = await request<DesafioParticipante[]>("desafio_participantes", { method: "POST", body: JSON.stringify({ desafio_id: input.desafioId, aluno_id: input.alunoId, organization_id: input.organizationId }), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=desafio_id,aluno_id");
  return rows[0];
}
export async function removeDesafioParticipante(desafioId: string, alunoId: string) { await request("desafio_participantes", { method: "DELETE" }, `?desafio_id=eq.${encodeURIComponent(desafioId)}&aluno_id=eq.${encodeURIComponent(alunoId)}`); return { desafioId, alunoId }; }

export async function listDesafioProgressoForDesafio(desafioId: string) { return request<DesafioProgresso[]>("desafio_progresso", {}, `?select=*&desafio_id=eq.${encodeURIComponent(desafioId)}`); }
export async function listDesafioProgressoForAluno(alunoId: string) { return request<DesafioProgresso[]>("desafio_progresso", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}`); }
export async function setDesafioProgresso(input: { desafioId: string; alunoId: string; organizationId: string; concluido: boolean; valorAtual?: number | null; concluidoPor: string }) {
  const body = { desafio_id: input.desafioId, aluno_id: input.alunoId, organization_id: input.organizationId, concluido: input.concluido, valor_atual: input.valorAtual ?? null, concluido_por: input.concluido ? input.concluidoPor : null, concluido_em: input.concluido ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
  const rows = await request<DesafioProgresso[]>("desafio_progresso", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=desafio_id,aluno_id");
  return rows[0];
}

// Prescrição real de treino nunca pode puxar um exercício ainda em
// rascunho (não revisado pelo Admin Arke) — só o acervo publicado entra
// aqui.
export async function listExercisesCatalog() { return request<GlobalLibraryExercise[]>("exercicios", {}, "?select=id,nome,grupo_muscular,video_url&estado_publicacao=eq.publicado&order=nome.asc"); }

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
  // matricula_em marca o momento real da ativação (Módulo Academia).
  await request("profiles", { method: "PATCH", body: JSON.stringify({ full_name: invitation.full_name, organization_id: invitation.organization_id, status: "active", matricula_em: new Date().toISOString() }) }, `?user_id=eq.${encodeURIComponent(authUser.id)}`);

  const accepted = await request<MemberInvitation[]>("member_invitations", { method: "PATCH", body: JSON.stringify({ status: "accepted" }) }, `?id=eq.${encodeURIComponent(invitation.id)}&status=eq.pending`);
  if (!accepted[0]) throw new Error("Este convite já foi utilizado.");

  // Se este convite veio de uma conversão de lead (CRM), o aceite real é o
  // momento certo de contar a matrícula — não o envio do convite (ver
  // converterLead). Best-effort: não afeta nada se não houver lead vinculado.
  await request("leads", { method: "PATCH", body: JSON.stringify({ estagio: "matriculado", convertido_em: new Date().toISOString() }) }, `?member_invitation_id=eq.${encodeURIComponent(invitation.id)}&estagio=eq.convite_enviado`);

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

export type AutomacaoResultado = { tarefasEscaladas: number; lembretesCheckIn: number; lembretesConvite: number; followUpsLeads: number; erros: string[] };

export async function runAutomacaoDiaria(): Promise<AutomacaoResultado> {
  const resultado: AutomacaoResultado = { tarefasEscaladas: 0, lembretesCheckIn: 0, lembretesConvite: 0, followUpsLeads: 0, erros: [] };

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

  try {
    for (const lead of await listLeadsSemContato()) {
      try {
        if (await createFollowUpLeadIfNeeded(lead.id, lead.organization_id, DIAS_LEAD_SEM_CONTATO)) resultado.followUpsLeads += 1;
      } catch (error) {
        resultado.erros.push(`follow-up lead ${lead.id}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    resultado.erros.push(`listar leads sem contato: ${(error as Error).message}`);
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

// --- Fase 9: Módulo Academia (matrícula, frequência, ficha em PDF) ---

export type FrequenciaRegistro = { id: string; aluno_id: string; organization_id: string; unit_id?: string | null; origem: "catraca" | "manual"; registrado_por?: string | null; registrado_em: string; created_at: string };

export async function registrarFrequencia(input: { alunoId: string; organizationId: string; unitId?: string | null; origem: FrequenciaRegistro["origem"]; registradoPor?: string }) {
  const rows = await request<FrequenciaRegistro[]>("frequencia_registros", { method: "POST", body: JSON.stringify({ aluno_id: input.alunoId, organization_id: input.organizationId, unit_id: input.unitId || undefined, origem: input.origem, registrado_por: input.registradoPor || undefined }) });
  return rows[0];
}

export async function listFrequenciaForAluno(alunoId: string, limit = 30) {
  return request<FrequenciaRegistro[]>("frequencia_registros", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=registrado_em.desc&limit=${limit}`);
}

export async function listFrequenciaForOrganization(organizationId: string, limit = 100) {
  return request<FrequenciaRegistro[]>("frequencia_registros", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=registrado_em.desc&limit=${limit}`);
}

// Ficha de treino em PDF, dimensionada para bobina de impressora
// térmica de 80mm — não integra com impressora nenhuma, só gera o PDF
// no tamanho certo para imprimir direto numa térmica USB/rede comum.
function sanitizePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function buildThermalPdfBase64(lines: string[]) {
  const widthPt = 80 * 2.8346; // 80mm em pontos (1mm = 2.8346pt)
  const lineHeight = 12;
  const marginTop = 16;
  const heightPt = Math.max(140, marginTop + lineHeight * (lines.length + 1));
  const contentLines = lines.map((line, index) => index === 0 ? `(${sanitizePdfText(line)}) Tj` : `0 -${lineHeight} Td\n(${sanitizePdfText(line)}) Tj`);
  const content = ["BT", "/F1 8 Tf", `8 ${(heightPt - marginTop).toFixed(2)} Td`, ...contentLines, "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = Buffer.byteLength(pdf, "utf8"); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "utf8");
  const entries = offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n ").join("\n");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8").toString("base64");
}

export async function gerarFichaTreinoPdf(treinoId: string) {
  const treino = await getTreino(treinoId);
  if (!treino) throw new Error("Treino não encontrado.");
  const [exercicios, catalogo, aluno] = await Promise.all([
    listTreinoExercicios(treinoId),
    listExercisesCatalog(),
    getProfileByUserId(treino.aluno_id),
  ]);
  const nomeExercicio = (idValue: string) => catalogo.find((exercicio) => exercicio.id === idValue)?.nome ?? "Exercício";
  const orgNome = treino.organization_id ? await getOrganizationName(treino.organization_id) : "Arke";

  const lines: string[] = [
    orgNome,
    `Ficha: ${treino.titulo} (${treino.tipo})`,
    `Aluno: ${aluno?.full_name ?? "-"}`,
    `Versao ${treino.versao} - ${new Date().toLocaleDateString("pt-BR")}`,
    "-".repeat(30),
  ];
  if (!exercicios.length) lines.push("Nenhum exercicio cadastrado.");
  exercicios.forEach((exercicio, index) => {
    lines.push(`${index + 1}. ${nomeExercicio(exercicio.exercicio_id)}`);
    lines.push(`   ${exercicio.series}x${exercicio.repeticoes}  descanso ${exercicio.descanso_seg}s`);
    if (exercicio.observacoes) lines.push(`   Obs: ${exercicio.observacoes}`);
  });
  lines.push("-".repeat(30));
  lines.push("Bom treino!");

  return { filename: `ficha-${treino.titulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-v${treino.versao}.pdf`, contentBase64: buildThermalPdfBase64(lines) };
}

// --- Fase 10: Módulo Studio (turmas, horários fixos, limite de vagas, agenda) ---

export type Turma = { id: string; organization_id: string; unit_id?: string | null; nome: string; descricao?: string | null; professor_id?: string | null; limite_vagas: number; duracao_min: number; status: "ativa" | "inativa"; criado_por?: string | null; created_at: string; updated_at: string };
export type TurmaHorario = { id: string; turma_id: string; dia_semana: number; hora_inicio: string; created_at: string };
export type TurmaReserva = { id: string; turma_id: string; aluno_id: string; organization_id: string; data: string; status: "confirmada" | "cancelada"; criado_em: string };

export async function listTurmasForOrganization(organizationId: string) { return request<Turma[]>("turmas", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=nome.asc`); }
export async function listTurmasAtivas(organizationId: string) { return request<Turma[]>("turmas", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.ativa&order=nome.asc`); }
export async function getTurma(idValue: string) { const rows = await request<Turma[]>("turmas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`); return rows[0] ?? null; }
export async function createTurma(input: Record<string, unknown>) { const rows = await request<Turma[]>("turmas", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateTurma(idValue: string, input: Record<string, unknown>) { const rows = await request<Turma[]>("turmas", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteTurma(idValue: string) { await request("turmas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function listTurmaHorarios(turmaId: string) { return request<TurmaHorario[]>("turma_horarios", {}, `?select=*&turma_id=eq.${encodeURIComponent(turmaId)}&order=dia_semana.asc,hora_inicio.asc`); }
export async function replaceTurmaHorarios(turmaId: string, items: Array<{ dia_semana: number; hora_inicio: string }>) {
  await request("turma_horarios", { method: "DELETE" }, `?turma_id=eq.${encodeURIComponent(turmaId)}`);
  if (!items.length) return [];
  return request<TurmaHorario[]>("turma_horarios", { method: "POST", body: JSON.stringify(items.map((item) => ({ ...item, turma_id: turmaId }))) });
}

export async function listReservasForTurmaData(turmaId: string, data: string) {
  return request<TurmaReserva[]>("turma_reservas", {}, `?select=*&turma_id=eq.${encodeURIComponent(turmaId)}&data=eq.${encodeURIComponent(data)}&status=eq.confirmada`);
}

export async function getReserva(idValue: string) {
  const rows = await request<TurmaReserva[]>("turma_reservas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}

export async function listMinhasReservas(alunoId: string) {
  const hoje = new Date().toISOString().slice(0, 10);
  return request<TurmaReserva[]>("turma_reservas", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&status=eq.confirmada&data=gte.${encodeURIComponent(hoje)}&order=data.asc`);
}

export async function getVagasDisponiveis(turmaId: string, data: string) {
  const turma = await getTurma(turmaId);
  if (!turma) throw new Error("Turma não encontrada.");
  const reservas = await listReservasForTurmaData(turmaId, data);
  return { limite: turma.limite_vagas, ocupadas: reservas.length, disponiveis: Math.max(0, turma.limite_vagas - reservas.length) };
}

export async function reservarVaga(input: { turmaId: string; alunoId: string; organizationId: string; data: string }) {
  const turma = await getTurma(input.turmaId);
  if (!turma || turma.status !== "ativa" || turma.organization_id !== input.organizationId) throw new Error("Turma não encontrada ou inativa.");
  const horarios = await listTurmaHorarios(input.turmaId);
  const diaSemana = new Date(`${input.data}T00:00:00Z`).getUTCDay();
  if (!horarios.some((horario) => horario.dia_semana === diaSemana)) throw new Error("Esta turma não tem horário nesse dia da semana.");
  const existentes = await listReservasForTurmaData(input.turmaId, input.data);
  if (existentes.some((reserva) => reserva.aluno_id === input.alunoId)) throw new Error("Você já reservou vaga nesta sessão.");
  if (existentes.length >= turma.limite_vagas) throw new Error("Não há vagas disponíveis para esta sessão.");
  const rows = await request<TurmaReserva[]>("turma_reservas", { method: "POST", body: JSON.stringify({ turma_id: input.turmaId, aluno_id: input.alunoId, organization_id: input.organizationId, data: input.data }) });
  return rows[0];
}

export async function cancelarReserva(idValue: string, alunoId: string) {
  const rows = await request<TurmaReserva[]>("turma_reservas", { method: "PATCH", body: JSON.stringify({ status: "cancelada" }) }, `?id=eq.${encodeURIComponent(idValue)}&aluno_id=eq.${encodeURIComponent(alunoId)}`);
  if (!rows[0]) throw new Error("Reserva não encontrada.");
  return rows[0];
}

export async function cancelarReservaStaff(idValue: string) {
  const rows = await request<TurmaReserva[]>("turma_reservas", { method: "PATCH", body: JSON.stringify({ status: "cancelada" }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Reserva não encontrada.");
  return rows[0];
}

// --- Fase 12: CRM de vendas (funil de leads, follow-up, fechamento) ---

export type Lead = {
  id: string; organization_id: string; unit_id: string | null; nome: string; telefone: string | null; email: string | null; origem: string | null; interesse: string | null;
  estagio: "novo" | "contato_feito" | "visita_agendada" | "convite_enviado" | "matriculado" | "perdido";
  responsavel_id: string | null; notas: string | null; motivo_perda: string | null;
  member_invitation_id: string | null; convertido_em: string | null; criado_por: string | null;
  created_at: string; updated_at: string;
};

export type LeadAtividade = {
  id: string; lead_id: string; organization_id: string; tipo: "nota" | "follow_up_automatico";
  descricao: string | null; status: "aberta" | "concluida"; responsavel_id: string | null; criado_por: string | null; created_at: string;
};

const DIAS_LEAD_SEM_CONTATO = 3;

export async function listLeadsForOrganization(organizationId: string) {
  return request<Lead[]>("leads", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc`);
}

export async function getLead(idValue: string) {
  const rows = await request<Lead[]>("leads", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}

export async function createLead(input: { organizationId: string; unitId?: string; nome: string; telefone?: string; email?: string; origem?: string; interesse?: string; responsavelId?: string; notas?: string; criadoPor?: string }) {
  const rows = await request<Lead[]>("leads", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, unit_id: input.unitId || undefined, nome: input.nome, telefone: input.telefone || undefined, email: input.email || undefined, origem: input.origem || undefined, interesse: input.interesse || undefined, responsavel_id: input.responsavelId || undefined, notas: input.notas || undefined, criado_por: input.criadoPor || undefined }) });
  return rows[0];
}

export async function updateLead(idValue: string, data: { nome?: string; telefone?: string | null; email?: string | null; origem?: string | null; interesse?: string | null; unitId?: string | null; responsavelId?: string | null; notas?: string | null }) {
  const rows = await request<Lead[]>("leads", { method: "PATCH", body: JSON.stringify({ nome: data.nome, telefone: data.telefone, email: data.email, origem: data.origem, interesse: data.interesse, unit_id: data.unitId, responsavel_id: data.responsavelId, notas: data.notas }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Lead não encontrado.");
  return rows[0];
}

export async function deleteLead(idValue: string) {
  await request("leads", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { success: true } as const;
}

async function closeOpenFollowUps(leadId: string) {
  await request("lead_atividades", { method: "PATCH", body: JSON.stringify({ status: "concluida" }) }, `?lead_id=eq.${encodeURIComponent(leadId)}&tipo=eq.follow_up_automatico&status=eq.aberta`);
}

export async function moverEstagioLead(idValue: string, estagio: "novo" | "contato_feito" | "visita_agendada") {
  const rows = await request<Lead[]>("leads", { method: "PATCH", body: JSON.stringify({ estagio }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Lead não encontrado.");
  await closeOpenFollowUps(idValue); // mudou de estágio: houve avanço, a tarefa de follow-up perde o sentido.
  return rows[0];
}

export async function marcarLeadPerdido(idValue: string, motivoPerda: string) {
  const rows = await request<Lead[]>("leads", { method: "PATCH", body: JSON.stringify({ estagio: "perdido", motivo_perda: motivoPerda }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Lead não encontrado.");
  await closeOpenFollowUps(idValue);
  return rows[0];
}

// Conversão em duas etapas: aqui só marca que o convite foi ENVIADO
// ("convite_enviado") — "matriculado" e convertido_em só são gravados
// quando o convite é de fato ACEITO (ver acceptMemberInvitation abaixo).
// Antes disso, a métrica de conversão contava convite enviado como
// matrícula, mesmo que o aluno nunca tivesse aberto o e-mail.
export async function converterLead(idValue: string, invitedByUserId: string) {
  const lead = await getLead(idValue);
  if (!lead) throw new Error("Lead não encontrado.");
  if (lead.estagio === "matriculado") throw new Error("Este lead já foi convertido.");
  if (lead.estagio === "convite_enviado") throw new Error("O convite já foi enviado a este lead — aguarde o aceite ou reenvie pelo painel de convites pendentes.");
  if (lead.estagio === "perdido") throw new Error("Este lead está marcado como perdido.");
  if (!lead.email) throw new Error("Informe o e-mail do lead antes de converter — o convite de aluno exige e-mail.");
  const invitation = await inviteMember({ organizationId: lead.organization_id, invitedByUserId, email: lead.email, fullName: lead.nome });
  const rows = await request<Lead[]>("leads", { method: "PATCH", body: JSON.stringify({ estagio: "convite_enviado", member_invitation_id: invitation.id }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  await closeOpenFollowUps(idValue);
  return { lead: rows[0], invitation };
}

export async function listLeadAtividades(leadId: string) {
  return request<LeadAtividade[]>("lead_atividades", {}, `?select=*&lead_id=eq.${encodeURIComponent(leadId)}&order=created_at.desc`);
}

export async function createLeadNota(input: { leadId: string; organizationId: string; descricao: string; criadoPor: string; responsavelId?: string }) {
  const rows = await request<LeadAtividade[]>("lead_atividades", { method: "POST", body: JSON.stringify({ lead_id: input.leadId, organization_id: input.organizationId, tipo: "nota", status: "concluida", descricao: input.descricao, criado_por: input.criadoPor, responsavel_id: input.responsavelId || undefined }) });
  await closeOpenFollowUps(input.leadId); // registrar contato resolve a pendência de follow-up.
  return rows[0];
}

// Regra de automação — evento: lead ativo (não matriculado, não perdido)
// sem nenhum contato registrado (nota ou follow-up) há N dias no mesmo
// estágio. condição: nenhum follow-up automático já aberto para o lead
// (índice único garante isso). ação: cria tarefa de follow-up para o
// responsável. limite de repetição: 1 por vez — a próxima só é criada
// depois que a anterior for resolvida (mudança de estágio, perda ou
// conversão fecha o follow-up aberto).
export async function listLeadsSemContato(dias = DIAS_LEAD_SEM_CONTATO) {
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const candidatos = await request<Lead[]>("leads", {}, `?select=id,organization_id,created_at&estagio=not.in.(matriculado,perdido)&created_at=lt.${encodeURIComponent(cutoff)}`);
  if (!candidatos.length) return [];
  const ids = candidatos.map((c) => c.id).join(",");
  const atividades = await request<{ lead_id: string; created_at: string }[]>("lead_atividades", {}, `?select=lead_id,created_at&lead_id=in.(${ids})&order=created_at.desc`);
  const ultimaAtividade = new Map<string, string>();
  for (const atividade of atividades) if (!ultimaAtividade.has(atividade.lead_id)) ultimaAtividade.set(atividade.lead_id, atividade.created_at);
  return candidatos.filter((lead) => (ultimaAtividade.get(lead.id) ?? lead.created_at) < cutoff);
}

export async function createFollowUpLeadIfNeeded(leadId: string, organizationId: string, dias: number) {
  try {
    return await request<LeadAtividade[]>("lead_atividades", { method: "POST", body: JSON.stringify({ lead_id: leadId, organization_id: organizationId, tipo: "follow_up_automatico", status: "aberta", descricao: `Sem contato registrado há mais de ${dias} dias.` }) }).then((rows) => rows[0]);
  } catch {
    return null; // já existe um follow-up aberto para este lead — nunca duplicar.
  }
}

// Indicadores do CRM — tudo calculado a partir de leads/lead_atividades já
// existentes, sem tabela nova (CLAUDE.md: nunca fingir uma análise que não
// foi feita). Prioridade/estágio continuam sem falsa precisão (§6): os
// indicadores mostram contagens e médias explicáveis, nunca uma nota
// sintética de "propensão à compra".
export type CrmIndicadores = {
  porEstagio: Record<Lead["estagio"], number>;
  taxaConversao: number | null;
  porOrigem: Array<{ origem: string; total: number }>;
  motivosPerda: Array<{ motivo: string; total: number }>;
  followUps: { abertos: number; atrasados: number };
  tempoMedioPrimeiraRespostaHoras: number | null;
  novosPorDia: Array<{ data: string; total: number }>;
};

const FOLLOW_UP_ATRASADO_HORAS = 48;

export async function getCrmIndicadores(organizationId: string, unitId?: string): Promise<CrmIndicadores> {
  const filtroUnidade = unitId ? `&unit_id=eq.${encodeURIComponent(unitId)}` : "";
  const trintaDiasAtras = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();

  const [leads, atividadesOrg] = await Promise.all([
    request<Lead[]>("leads", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${filtroUnidade}`),
    request<LeadAtividade[]>("lead_atividades", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.asc`),
  ]);

  const leadIds = new Set(leads.map((lead) => lead.id));
  const atividades = atividadesOrg.filter((atividade) => leadIds.has(atividade.lead_id));

  const porEstagio: CrmIndicadores["porEstagio"] = { novo: 0, contato_feito: 0, visita_agendada: 0, convite_enviado: 0, matriculado: 0, perdido: 0 };
  for (const lead of leads) porEstagio[lead.estagio] += 1;

  const totalConsiderado = leads.length - porEstagio.perdido;
  const taxaConversao = totalConsiderado > 0 ? porEstagio.matriculado / totalConsiderado : null;

  const origemMap = new Map<string, number>();
  for (const lead of leads) { const chave = lead.origem?.trim() || "Não informado"; origemMap.set(chave, (origemMap.get(chave) ?? 0) + 1); }
  const porOrigem = Array.from(origemMap.entries()).map(([origem, total]) => ({ origem, total })).sort((a, b) => b.total - a.total);

  const motivoMap = new Map<string, number>();
  for (const lead of leads) { if (lead.estagio !== "perdido" || !lead.motivo_perda) continue; const chave = lead.motivo_perda.trim(); motivoMap.set(chave, (motivoMap.get(chave) ?? 0) + 1); }
  const motivosPerda = Array.from(motivoMap.entries()).map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total).slice(0, 8);

  const followUpsAbertos = atividades.filter((atividade) => atividade.tipo === "follow_up_automatico" && atividade.status === "aberta");
  const agora = Date.now();
  const followUpsAtrasados = followUpsAbertos.filter((atividade) => (agora - new Date(atividade.created_at).getTime()) / (1000 * 60 * 60) > FOLLOW_UP_ATRASADO_HORAS);

  const primeiraNotaPorLead = new Map<string, string>();
  for (const atividade of atividades) {
    if (atividade.tipo !== "nota") continue;
    if (!primeiraNotaPorLead.has(atividade.lead_id)) primeiraNotaPorLead.set(atividade.lead_id, atividade.created_at);
  }
  const temposResposta: number[] = [];
  for (const lead of leads) {
    const primeiraNota = primeiraNotaPorLead.get(lead.id);
    if (!primeiraNota) continue;
    temposResposta.push((new Date(primeiraNota).getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60));
  }
  const tempoMedioPrimeiraRespostaHoras = temposResposta.length ? temposResposta.reduce((soma, valor) => soma + valor, 0) / temposResposta.length : null;

  const novosPorDiaMap = new Map<string, number>();
  for (const lead of leads) {
    if (lead.created_at < trintaDiasAtras) continue;
    const dia = lead.created_at.slice(0, 10);
    novosPorDiaMap.set(dia, (novosPorDiaMap.get(dia) ?? 0) + 1);
  }
  const novosPorDia = Array.from(novosPorDiaMap.entries()).map(([data, total]) => ({ data, total })).sort((a, b) => a.data.localeCompare(b.data));

  return { porEstagio, taxaConversao, porOrigem, motivosPerda, followUps: { abertos: followUpsAbertos.length, atrasados: followUpsAtrasados.length }, tempoMedioPrimeiraRespostaHoras, novosPorDia };
}

// --- LGPD: consentimento versionado e direito de exclusão ---
//
// As funções aqui usam o service_role (contorna RLS, como todo o resto
// deste arquivo) — por isso o escopo por organização é feito explicitamente
// nos filtros abaixo, nunca deixado só para a policy do banco.

async function rpc<T>(fn: string, args: Record<string, unknown>) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`Supabase RPC ${fn} ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export type PrivacyPolicyVersion = { id: string; version: string; title: string; content: string; effective_at: string; created_at: string };
export type ConsentType = "termos_uso_privacidade" | "dados_saude";
export type UserConsent = { id: string; user_id: string | null; consent_type: ConsentType; policy_version_id: string | null; granted: boolean; created_at: string };
export type DataDeletionRequest = { id: string; user_id: string | null; organization_id: string | null; status: "pending" | "completed" | "rejected"; reason: string | null; requested_at: string; resolved_at: string | null; resolved_by: string | null; resolution_note: string | null };

export async function getCurrentPrivacyPolicy() {
  const rows = await request<PrivacyPolicyVersion[]>("privacy_policy_versions", {}, "?select=*&order=effective_at.desc&limit=1");
  return rows[0] ?? null;
}

export async function hasConsent(userId: string, consentType: ConsentType) {
  const rows = await request<{ id: string }[]>("user_consents", {}, `?select=id&user_id=eq.${encodeURIComponent(userId)}&consent_type=eq.${consentType}&granted=eq.true&limit=1`);
  return rows.length > 0;
}

export async function recordConsent(input: { userId: string; consentType: ConsentType; policyVersionId?: string | null; ipAddress?: string; userAgent?: string }) {
  const rows = await request<UserConsent[]>("user_consents", { method: "POST", body: JSON.stringify({ user_id: input.userId, consent_type: input.consentType, policy_version_id: input.policyVersionId ?? null, granted: true, ip_address: input.ipAddress ?? null, user_agent: input.userAgent ?? null }) });
  return rows[0];
}

// Um pedido pendente por vez — o próprio aluno vê o status do que já
// solicitou em vez de acumular pedidos duplicados.
export async function createDeletionRequest(input: { userId: string; organizationId: string | null; reason?: string }) {
  const existing = await request<{ id: string }[]>("data_deletion_requests", {}, `?select=id&user_id=eq.${encodeURIComponent(input.userId)}&status=eq.pending&limit=1`);
  if (existing.length) throw new Error("Você já tem uma solicitação de exclusão pendente.");
  const rows = await request<DataDeletionRequest[]>("data_deletion_requests", { method: "POST", body: JSON.stringify({ user_id: input.userId, organization_id: input.organizationId, reason: input.reason || undefined }) });
  return rows[0];
}

export async function getMyDeletionRequest(userId: string) {
  const rows = await request<DataDeletionRequest[]>("data_deletion_requests", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=requested_at.desc&limit=1`);
  return rows[0] ?? null;
}

export async function getDeletionRequest(idValue: string) {
  const rows = await request<DataDeletionRequest[]>("data_deletion_requests", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}

export async function listDeletionRequests(organizationId: string, status?: DataDeletionRequest["status"]) {
  return request<DataDeletionRequest[]>("data_deletion_requests", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${status ? `&status=eq.${status}` : ""}&order=requested_at.asc`);
}

// A purga em si é feita por delete_member_data (security definer no banco —
// ver supabase/20260915_lgpd_consentimento_exclusao.sql), não aqui: o
// service_role não tem permissão de execução revogada, mas o corpo da
// função continua sendo a única coisa que sabe apagar de cada tabela.
export async function fulfillDeletionRequest(input: { requestId: string; alunoId: string; resolvedBy: string; note?: string }) {
  await rpc("delete_member_data", { p_aluno_id: input.alunoId, p_resolved_by: input.resolvedBy, p_request_id: input.requestId, p_note: input.note || null });
  return { requestId: input.requestId, status: "completed" as const };
}

export async function rejectDeletionRequest(input: { requestId: string; organizationId: string; resolvedBy: string; note?: string }) {
  const rows = await request<DataDeletionRequest[]>("data_deletion_requests", { method: "PATCH", body: JSON.stringify({ status: "rejected", resolved_at: new Date().toISOString(), resolved_by: input.resolvedBy, resolution_note: input.note || null }) }, `?id=eq.${encodeURIComponent(input.requestId)}&organization_id=eq.${encodeURIComponent(input.organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Solicitação não encontrada ou já resolvida.");
  return rows[0];
}
