import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { acceptOrganizationInvitation, archiveOrganizationUnit, auditLogsToCsv, auditLogsToPdfBase64, createOrganizationInvitation, createOrganizationUnit, createOrganizationWithOwner, getAuditLogs, getMembership, getOrganizationAccess, getOrganizationOnboarding, getOrganizationSubscription, getOrganizationsForUser, getPendingOrganizationInvitations, recordAuditLog, saveOrganizationOnboarding, updateModulePolicy, updateOrganizationProfile, updateOrganizationSubscription } from "./db";
import { createAppStudent, createAppUser, createGlobalExercise, createGlobalGroup, createGlobalNutritionPlan, createGlobalRoutine, createGlobalTemplate, createPasswordRecovery, deleteAppStudent, deleteAppUser, deleteGlobalExercise, deleteGlobalGroup, deleteGlobalNutritionPlan, deleteGlobalRoutine, deleteGlobalTemplate, deleteGlobalAccessRule, hasSupabaseConfig, listAppStudents, listAppUsers, listGlobalLibrary, normalizeEmail, signInWithSupabase, updateAppStudent, updateAppUser, updateGlobalExercise, updateGlobalGroup, updateGlobalNutritionPlan, updateGlobalRoutine, updateGlobalTemplate, upsertGlobalAccessRule } from "./supabaseAdmin";
import { asaasSandboxConfigured, createAsaasCustomer, createAsaasPayment, createAsaasWebhook, getAsaasAccount, listAsaasPayments } from "./asaas";
import { listStoredAsaasPayments } from "./asaasPersistence";
import { lookupCnpj } from "./cnpj";

const organizationIdInput = z.object({ organizationId: z.number().int().positive() });
const moduleName = z.enum(["dashboard", "academias", "profissionais", "alunos", "agenda", "financeiro", "integracoes"]);
const roleName = z.enum(["owner", "admin", "manager", "professional", "viewer"]);
const auditFilterInput = z.object({ organizationId: z.number().int().positive(), from: z.string().optional(), to: z.string().optional(), userId: z.number().int().positive().optional(), entity: z.string().max(64).optional() });

const auditFilters = (input: z.infer<typeof auditFilterInput>) => ({ from: input.from ? new Date(`${input.from}T00:00:00.000Z`) : undefined, to: input.to ? new Date(`${input.to}T23:59:59.999Z`) : undefined, userId: input.userId, entity: input.entity });

const ownerOrAdmin = async (userId: number, organizationId: number) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership || !["owner", "admin", "manager"].includes(membership.membership.role)) throw new Error("You do not have permission to manage this organization");
  return membership;
};

const hasOrganizationAccess = async (userId: number, organizationId: number) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership) throw new Error("Organization access denied");
  return membership;
};

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    signIn: publicProcedure.input(z.object({ email: z.string().email(), password: z.string().min(8) })).mutation(({ input }) => signInWithSupabase(input.email, input.password)),
    recoverPassword: publicProcedure.input(z.object({ email: z.string().email() })).mutation(({ input }) => createPasswordRecovery(normalizeEmail(input.email))),
  }),
  admin: router({
    status: publicProcedure.query(() => ({ configured: hasSupabaseConfig() })),
    lookupCnpj: publicProcedure.input(z.object({ cnpj: z.string().min(14).max(18) })).mutation(({ input }) => lookupCnpj(input.cnpj)),
    users: router({
      list: publicProcedure.query(() => listAppUsers()),
      create: publicProcedure.input(z.object({ name: z.string().trim().min(2), email: z.string().email(), username: z.string().trim().min(2).max(80), module: z.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z.string().trim().min(2), status: z.enum(["Ativo", "Suspenso"]), logoUrl: z.string().max(1000000).optional().nullable(), profileData: z.record(z.string(), z.string()).optional() })).mutation(({ input }) => createAppUser({ ...input, profile_data: input.profileData, email: normalizeEmail(input.email) })),
      update: publicProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ name: z.string().trim().min(2), email: z.string().email(), username: z.string().trim().min(2), module: z.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z.string().trim().min(2), status: z.enum(["Ativo", "Suspenso"]), logoUrl: z.string().max(1000000).optional().nullable(), profileData: z.record(z.string(), z.string()).optional() }) })).mutation(({ input }) => updateAppUser(input.id, { ...input.data, profile_data: input.data.profileData, email: normalizeEmail(input.data.email) })),
      delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteAppUser(input.id)),
    }),
    students: router({
      list: publicProcedure.query(() => listAppStudents()),
      create: publicProcedure.input(z.object({ name: z.string().trim().min(2), academy: z.string().trim().min(2), plan: z.string().trim().min(2), status: z.enum(["Ativo", "Inativo"]) })).mutation(({ input }) => createAppStudent(input)),
      update: publicProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ name: z.string().trim().min(2), academy: z.string().trim().min(2), plan: z.string().trim().min(2), status: z.enum(["Ativo", "Inativo"]) }) })).mutation(({ input }) => updateAppStudent(input.id, input.data)),
      delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteAppStudent(input.id)),
    }),
  }),
  globalLibrary: router({
    list: adminProcedure.query(() => listGlobalLibrary()),
    exercises: router({
      create: adminProcedure.input(z.object({ nome: z.string().trim().min(2), grupo_muscular: z.string().trim().min(2), descricao: z.string().trim().optional(), instrucoes: z.string().trim().optional(), video_url: z.string().url().optional(), imagem_url: z.string().url().optional(), equipamento: z.string().trim().optional() })).mutation(({ ctx, input }) => createGlobalExercise({ ...input, created_by: ctx.user.openId.replace(/^supabase:/, "") })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ nome: z.string().trim().min(2), grupo_muscular: z.string().trim().min(2), descricao: z.string().trim().optional().nullable(), instrucoes: z.string().trim().optional().nullable(), video_url: z.string().url().optional().nullable(), imagem_url: z.string().url().optional().nullable(), equipamento: z.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalExercise(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalExercise(input.id)),
    }),
    groups: router({
      create: adminProcedure.input(z.object({ nome: z.string().trim().min(2), ordem: z.number().int().min(0).default(0) })).mutation(({ input }) => createGlobalGroup(input)),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ nome: z.string().trim().min(2), ordem: z.number().int().min(0) }) })).mutation(({ input }) => updateGlobalGroup(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalGroup(input.id)),
    }),
    templates: router({
      create: adminProcedure.input(z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim().default(""), descricao: z.string().trim().optional(), divisoes: z.array(z.string().trim().min(1)).min(1) })).mutation(({ ctx, input }) => createGlobalTemplate({ ...input, criado_por: ctx.user.openId.replace(/^supabase:/, "") })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim(), descricao: z.string().trim().optional().nullable(), divisoes: z.array(z.string().trim().min(1)).min(1) }) })).mutation(({ input }) => updateGlobalTemplate(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalTemplate(input.id)),
    }),
    nutritionPlans: router({
      create: adminProcedure.input(z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim().default(""), objetivo: z.string().trim().optional(), descricao: z.string().trim().optional(), instrucoes: z.string().trim().optional() })).mutation(({ ctx, input }) => createGlobalNutritionPlan({ ...input, criado_por: ctx.user.openId.replace(/^supabase:/, "") })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim(), objetivo: z.string().trim().optional().nullable(), descricao: z.string().trim().optional().nullable(), instrucoes: z.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalNutritionPlan(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalNutritionPlan(input.id)),
    }),
    routines: router({
      create: adminProcedure.input(z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim().default(""), descricao: z.string().trim().optional(), rotina: z.string().trim().min(2) })).mutation(({ ctx, input }) => createGlobalRoutine({ ...input, criado_por: ctx.user.openId.replace(/^supabase:/, "") })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim(), descricao: z.string().trim().optional().nullable(), rotina: z.string().trim().min(2) }) })).mutation(({ input }) => updateGlobalRoutine(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalRoutine(input.id)),
    }),
    accessRules: router({
      upsert: adminProcedure.input(z.object({ modulo: z.enum(["academia", "studio", "profissional", "nutricionista"]), plano: z.string().trim().min(2), habilitado: z.boolean(), requer_consultoria: z.boolean().default(true) })).mutation(({ input }) => upsertGlobalAccessRule(input)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalAccessRule(input.id)),
    }),
  }),
  billing: router({
    asaasStatus: publicProcedure.query(() => ({ configured: asaasSandboxConfigured(), environment: "sandbox" as const })),
    asaasAccount: publicProcedure.query(() => getAsaasAccount()),
    asaasPayments: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => listAsaasPayments(input?.limit ?? 20)),
    asaasStoredPayments: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => listStoredAsaasPayments(input?.limit ?? 20)),
    createAsaasCustomer: publicProcedure.input(z.object({ name: z.string().trim().min(2), email: z.string().email(), cpfCnpj: z.string().trim().optional() })).mutation(({ input }) => createAsaasCustomer(input)),
    createAsaasPayment: publicProcedure.input(z.object({ customer: z.string().min(2), value: z.number().positive(), dueDate: z.string(), billingType: z.enum(["UNDEFINED", "PIX", "BOLETO", "CREDIT_CARD", "DEBIT_CARD"]), description: z.string().trim().min(2) })).mutation(({ input }) => createAsaasPayment(input)),
    createAsaasWebhook: publicProcedure.input(z.object({ url: z.string().url(), email: z.string().email() })).mutation(({ input }) => createAsaasWebhook(input)),
  }),
  saas: router({
    organizations: router({
      list: protectedProcedure.query(({ ctx }) => getOrganizationsForUser(ctx.user.id)),
      create: protectedProcedure.input(z.object({ clientId: z.string().uuid(), logoUrl: z.string().max(1000000).optional(), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), name: z.string().trim().min(2).max(160), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), plan: z.enum(["starter", "growth", "scale"]) })).mutation(({ ctx, input }) => createOrganizationWithOwner({ userId: ctx.user.id, ...input })),
      access: protectedProcedure.input(organizationIdInput).query(({ ctx, input }) => getOrganizationAccess(ctx.user.id, input.organizationId)),
      audit: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return getAuditLogs(input.organizationId, 100, auditFilters(input)); }),
      auditCsv: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return { filename: `arke-auditoria-${input.organizationId}.csv`, content: auditLogsToCsv(await getAuditLogs(input.organizationId, 500, auditFilters(input))) }; }),
      auditPdf: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return { filename: `arke-auditoria-${input.organizationId}.pdf`, contentBase64: auditLogsToPdfBase64(await getAuditLogs(input.organizationId, 500, auditFilters(input))) }; }),
      pendingInvitations: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return getPendingOrganizationInvitations(input.organizationId); }),
      createUnit: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), name: z.string().trim().min(2).max(160), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), city: z.string().trim().max(120).optional() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const unit = await createOrganizationUnit(input); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: unit.id, action: "created", entity: "organization_unit", entityId: unit.id, afterJson: input }); return unit; }),
      archiveUnit: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), unitId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await archiveOrganizationUnit(input.organizationId, input.unitId); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "archived", entity: "organization_unit", entityId: input.unitId, afterJson: result }); return result; }),
      subscription: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return getOrganizationSubscription(input.organizationId); }),
      updateProfile: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), name: z.string().trim().min(2).max(160), logoUrl: z.string().max(1000000).optional(), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return updateOrganizationProfile(input); }),
      updateSubscription: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), plan: z.enum(["starter", "growth", "scale"]), status: z.enum(["trialing", "active", "past_due", "canceled"]).optional() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await updateOrganizationSubscription(input); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "subscription", afterJson: input }); return result; }),
      onboarding: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return getOrganizationOnboarding(input.organizationId); }),
      saveOnboarding: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), currentStep: z.number().int().min(1).max(4), status: z.enum(["not_started", "in_progress", "completed"]), city: z.string().trim().max(120).optional(), defaultUnitName: z.string().trim().min(2).max(160).optional(), inviteEmail: z.string().email().optional(), logoUrl: z.string().url().max(512).optional(), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await saveOrganizationOnboarding(input); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "onboarding_branding", afterJson: input }); return result; }),
      updatePolicy: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), unitId: z.number().int().positive(), role: roleName, module: moduleName, canView: z.number().int().min(0).max(1), canManage: z.number().int().min(0).max(1) })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await updateModulePolicy(input); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "updated", entity: "module_policy", afterJson: input }); return result; }),
      invite: protectedProcedure.input(z.object({ organizationId: z.number().int().positive(), email: z.string().email(), role: z.enum(["admin", "manager", "professional", "viewer"]) })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const rawToken = randomUUID(); const tokenHash = createHash("sha256").update(rawToken).digest("hex"); const invitation = await createOrganizationInvitation({ ...input, invitedByUserId: ctx.user.id, email: input.email.toLowerCase(), tokenHash, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 72) }); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "invitation", entityId: invitation.id, afterJson: { email: input.email.toLowerCase(), role: input.role } }); return { invitationId: invitation.id, token: rawToken, status: "pending" as const }; }),
      acceptInvite: protectedProcedure.input(z.object({ token: z.string().min(16).max(128) })).mutation(async ({ ctx, input }) => { if (!ctx.user.email) throw new Error("Authenticated user email is required"); const result = await acceptOrganizationInvitation({ tokenHash: createHash("sha256").update(input.token).digest("hex"), userId: ctx.user.id, email: ctx.user.email }); await recordAuditLog({ organizationId: result.organizationId, userId: ctx.user.id, action: "accepted", entity: "invitation", entityId: result.invitation.id, afterJson: { role: result.role, email: ctx.user.email } }); return { organizationId: result.organizationId, role: result.role, status: "accepted" as const }; }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
