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

export type AppUser = { id: string; name: string; email: string; username: string; module: string; role: string; status: string; logoUrl?: string | null; created_at: string; updated_at: string };
export type AppStudent = { id: string; name: string; academy: string; plan: string; status: string; created_at: string; updated_at: string };

export async function signInWithSupabase(email: string, password: string) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password }) });
  if (!response.ok) throw new Error("Usuário ou senha inválidos.");
  const data = await response.json() as { access_token: string; refresh_token: string; user: { id: string; email?: string; user_metadata?: Record<string, unknown> } };
  return { accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user };
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
