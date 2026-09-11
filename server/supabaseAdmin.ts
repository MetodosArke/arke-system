import { randomUUID, createHash } from "node:crypto";
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
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export type AppUser = { id: string; name: string; email: string; username: string; module: string; role: string; status: string; logoUrl?: string | null; profile_data?: Record<string, string> | null; created_at: string; updated_at: string };
export type AppStudent = { id: string; name: string; academy: string; plan: string; status: string; created_at: string; updated_at: string };

export async function authenticateSupabaseAccessToken(accessToken: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Supabase access token inválido");
  return response.json() as Promise<{ id: string; email?: string; user_metadata?: Record<string, unknown> }>;
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

const defaultClientUsers: Array<Omit<AppUser, "id" | "created_at" | "updated_at">> = [
  { name: "Vértice Academia", email: "academia@arke.demo", username: "academia", module: "academia", role: "Gestor de Academia", status: "Ativo", logoUrl: "/arke-logo.png" },
  { name: "Box Norte 360", email: "boxnorte@arke.demo", username: "box-norte-360", module: "academia", role: "Gestor de Academia", status: "Ativo", logoUrl: "/arke-logo.png" },
  { name: "FIT.ME", email: "contato.iconprime@gmail.com", username: "fit-me", module: "academia", role: "Gestor de Academia", status: "Ativo", logoUrl: "/arke-logo.png" },
  { name: "Studio Movimento", email: "studio@arke.demo", username: "studio", module: "studio", role: "Gestor de Studio", status: "Ativo", logoUrl: "/arke-logo.png" },
  { name: "Camila Rocha", email: "camila@arke.demo", username: "personal", module: "profissional", role: "Personal trainer", status: "Ativo", logoUrl: "/arke-logo.png" },
  { name: "Rafael Mendes", email: "rafael@arke.demo", username: "nutricionista", module: "profissional", role: "Nutricionista", status: "Ativo", logoUrl: "/arke-logo.png" },
];
export async function syncDefaultClientUsers() {
  const existing = await request<AppUser[]>("app_users", {}, "?select=*&order=created_at.asc");
  const emails = new Set(existing.map((item) => item.email.toLowerCase()));
  for (const client of defaultClientUsers) if (!emails.has(client.email)) { await request<AppUser[]>("app_users", { method: "POST", body: JSON.stringify({ id: id(), ...client }) }); emails.add(client.email); }
  return request<AppUser[]>("app_users", {}, "?select=*&order=created_at.asc");
}
export async function listAppUsers() { return request<AppUser[]>("app_users", {}, "?select=*&order=created_at.asc"); }
export async function createAppUser(input: Omit<AppUser, "id" | "created_at" | "updated_at">) { const authInvite = await createSupabaseAuthUser(input.email, input.name); const rows = await request<AppUser[]>("app_users", { method: "POST", body: JSON.stringify({ id: id(), ...input }) }); await sendInviteEmail(input.email, input.name, input.username, authInvite.action_link); await notifyAdmins("Novo cadastro no Arke", `<p>O cliente <strong>${input.name}</strong> foi cadastrado no módulo ${input.module}.</p><p>Usuário: ${input.username}</p>`); return rows[0]; }
export async function updateAppUser(idValue: string, input: Partial<Omit<AppUser, "id" | "created_at" | "updated_at">>) { const rows = await request<AppUser[]>("app_users", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`); await notifyAdmins("Cadastro atualizado no Arke", `<p>O cadastro <strong>${input.name ?? idValue}</strong> foi atualizado pela administração.</p>`); return rows[0]; }
export async function deleteAppUser(idValue: string) { await request("app_users", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); await notifyAdmins("Cadastro removido no Arke", `<p>O cadastro de usuário <strong>${idValue}</strong> foi removido pela administração.</p>`); return { id: idValue }; }

export async function listAppStudents() { return request<AppStudent[]>("app_students", {}, "?select=*&order=created_at.asc"); }
export async function createAppStudent(input: Omit<AppStudent, "id" | "created_at" | "updated_at">) { const rows = await request<AppStudent[]>("app_students", { method: "POST", body: JSON.stringify({ id: id(), ...input }) }); return rows[0]; }
export async function updateAppStudent(idValue: string, input: Partial<Omit<AppStudent, "id" | "created_at" | "updated_at">>) { const rows = await request<AppStudent[]>("app_students", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteAppStudent(idValue: string) { await request("app_students", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function createPasswordRecovery(email: string) {
  const token = id();
  await request("app_password_resets", { method: "POST", body: JSON.stringify({ id: id(), email: email.toLowerCase(), token_hash: hash(token), expires_at: new Date(Date.now() + 3600000).toISOString() }) });
  await sendEmail(email, "Recuperação de senha — Arke", `<p>Recebemos uma solicitação de recuperação de senha.</p><p>Use este código temporário no portal Arke:</p><h2>${token}</h2><p>Este código expira em 1 hora.</p>`);
  return { sent: true };
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
export type GlobalNutritionPlan = { id: string; titulo: string; categoria: string; objetivo?: string | null; descricao?: string | null; instrucoes?: string | null; created_at: string; updated_at?: string | null };
export type GlobalRoutine = { id: string; titulo: string; categoria: string; descricao?: string | null; rotina: string; created_at: string; updated_at?: string | null };
export type GlobalAccessRule = { id: string; modulo: string; plano: string; habilitado: boolean; requer_consultoria: boolean; created_at: string; updated_at: string };

export async function listGlobalLibrary() {
  const [exercises, groups, templates, nutritionPlans, routines, accessRules] = await Promise.all([
    request<GlobalLibraryExercise[]>("exercicios", {}, "?select=*&order=created_at.desc"),
    request<GlobalLibraryGroup[]>("grupos_musculares", {}, "?select=*&order=ordem.asc,nome.asc"),
    request<GlobalLibraryTemplate[]>("treino_templates", {}, "?select=*&order=created_at.desc"),
    request<GlobalNutritionPlan[]>("acervo_planos_alimentares", {}, "?select=*&order=created_at.desc"),
    request<GlobalRoutine[]>("acervo_rotinas", {}, "?select=*&order=created_at.desc"),
    request<GlobalAccessRule[]>("acervo_acesso_regras", {}, "?select=*&order=modulo.asc,plano.asc"),
  ]);
  return { exercises, groups, templates, nutritionPlans, routines, accessRules };
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

export async function createGlobalNutritionPlan(input: Record<string, unknown>) { const rows = await request<GlobalNutritionPlan[]>("acervo_planos_alimentares", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalNutritionPlan(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalNutritionPlan[]>("acervo_planos_alimentares", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalNutritionPlan(idValue: string) { await request("acervo_planos_alimentares", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function createGlobalRoutine(input: Record<string, unknown>) { const rows = await request<GlobalRoutine[]>("acervo_rotinas", { method: "POST", body: JSON.stringify(input) }); return rows[0]; }
export async function updateGlobalRoutine(idValue: string, input: Record<string, unknown>) { const rows = await request<GlobalRoutine[]>("acervo_rotinas", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`); return rows[0]; }
export async function deleteGlobalRoutine(idValue: string) { await request("acervo_rotinas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }

export async function upsertGlobalAccessRule(input: Record<string, unknown>) { const rows = await request<GlobalAccessRule[]>("acervo_acesso_regras", { method: "POST", body: JSON.stringify(input), headers: { Prefer: "resolution=merge-duplicates,return=representation" } }); return rows[0]; }
export async function deleteGlobalAccessRule(idValue: string) { await request("acervo_acesso_regras", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`); return { id: idValue }; }
