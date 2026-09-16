import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { COOKIE_NAME, SUPABASE_ACCESS_COOKIE } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { assertRateLimit, rateLimitKey } from "./_core/rateLimit";
import { acceptOrganizationInvitation, archiveOrganizationUnit, auditLogsToCsv, auditLogsToPdfBase64, createOrganizationInvitation, createOrganizationUnit, createOrganizationWithOwner, createSubscriptionCharge, getAuditLogs, getMembership, getOrganization, getOrganizationAccess, getOrganizationBySlug, getOrganizationOnboarding, getOrganizationSubscription, getOrganizationsForUser, getPendingOrganizationInvitations, recordAuditLog, revokeOrganizationInvitation, saveOrganizationOnboarding, updateModulePolicy, updateOrganizationProfile, updateOrganizationSubscription } from "./db";
import { acceptMemberInvitation, assignAtendimento, cancelarReserva, cancelarReservaStaff, converterLead, countAlunosComArkeAtivo, createAppStudent, createAppUser, createAtendimento, createDeletionRequest, createDieta, createGlobalExercise, createGlobalGroup, createGlobalNutritionPlan, createGlobalRoutine, createGlobalTemplate, createGlobalTemplateExercise, createLead, createLeadNota, createPasswordRecoveryCode, createTreino, createTurma, deleteAppStudent, deleteAppUser, deleteDieta, deleteGlobalExercise, deleteGlobalGroup, deleteGlobalNutritionPlan, deleteGlobalRoutine, deleteGlobalTemplate, deleteGlobalTemplateExercise, deleteGlobalAccessRule, deleteLead, deleteTreino, deleteTurma, findAppUserByEmail, fulfillDeletionRequest, gerarFichaTreinoPdf, getAcolhimento, getAlunoArkeLicenca, getArkeModule, getAtendimento, getAvaliacaoSemanal, getCheckinDoDia, getCrmIndicadores, getCurrentPrivacyPolicy, getDeletionRequest, getDieta, getGestaoIndicadores, getLead, getMyDeletionRequest, getPlanoTreinoSemanal, getProfileByUserId, getReserva, getTreino, getTurma, getVagasDisponiveis, hasConsent, hasSupabaseConfig, inviteMember, listAppStudents, listAppUsers, listAtendimentosForOrganization, listDeletionRequests, listDietasForAluno, listExercisesCatalog, listFrequenciaForAluno, listFrequenciaForOrganization, listGlobalLibrary, listLeadAtividades, listLeadsForOrganization, listMinhasReservas, listMyAtendimentos, listMyCheckIns, listPendingMemberInvitations, listReservasForTurmaData, listStudentsInOrganization, listTreinoExercicios, listTreinosForAluno, listTurmaHorarios, listTurmasAtivas, listTurmasForOrganization, marcarLeadPerdido, moverEstagioLead, normalizeEmail, publishDieta, publishGlobalExercises, publishGlobalNutritionPlans, publishGlobalTemplates, publishTreino, recordConsent, registrarFrequencia, rejectDeletionRequest, replaceTreinoExercicios, replaceTurmaHorarios, requestHelp, reservarVaga, resolveAtendimento, revokeMemberInvitation, signInWithSupabase, submitCheckIn, toggleAlunoArkeLicenca, updateAppStudent, updateAppUser, updateDieta, updateGlobalExercise, updateGlobalGroup, updateGlobalNutritionPlan, updateGlobalRoutine, updateGlobalTemplate, updateGlobalTemplateExercise, updateLead, updateStudentMatricula, updateSupabaseUserPassword, updateTreino, updateTurma, upsertAcolhimento, upsertArkeModule, upsertAvaliacaoSemanal, upsertCheckinDiario, upsertGlobalAccessRule, upsertPlanoTreinoSemanal, verifyPasswordRecoveryCode } from "./supabaseAdmin";
import { alunoTemArke, assertAlunoTemArke } from "./arkeEntitlement";
import { asaasConfigured, asaasEnvironment, createAsaasWebhook, getAsaasAccount, listAsaasPayments } from "./asaas";
import { listAsaasPaymentsForOrganization } from "./asaasPersistence";
import { lookupCnpj } from "./cnpj";
import { deleteTurnstileIntegration, listBenefitIntegrations, listTurnstileIntegrationsForOrganization, saveBenefitIntegration, saveTurnstileIntegration } from "./integrations";
import { openaiConfigured } from "./_core/llm";
import { sugerirExercicio, sugerirModeloTreino } from "./acervoAi";
import { DIETA_MAX_BYTES, DIETA_MIME_TYPES, EXERCICIO_VIDEO_MAX_BYTES, EXERCICIO_VIDEO_MIME_TYPES, LOGO_MAX_BYTES, LOGO_MIME_TYPES, decodeUpload, extensionFor, uploadPublicFile } from "./storage";
import { ARKE_MODULE_PACKAGE_AMOUNTS_CENTS, ORG_PLAN_KEYS, SAAS_PLAN_KEYS, type OrgPlan } from "@shared/pricing";

const organizationIdInput = z.object({ organizationId: z.string().uuid() });
const moduleName = z.enum(["dashboard", "academias", "profissionais", "alunos", "agenda", "financeiro", "integracoes"]);
const roleName = z.enum(["owner", "admin", "manager", "professional", "nutricionista", "viewer"]);
const auditFilterInput = z.object({ organizationId: z.string().uuid(), from: z.string().optional(), to: z.string().optional(), userId: z.string().uuid().optional(), entity: z.string().max(64).optional() });

const auditFilters = (input: z.infer<typeof auditFilterInput>) => ({ from: input.from ? new Date(`${input.from}T00:00:00.000Z`) : undefined, to: input.to ? new Date(`${input.to}T23:59:59.999Z`) : undefined, userId: input.userId, entity: input.entity });

// Fase 1c: chave de dia/semana calculada no servidor (nunca aceita do
// cliente) para check-in diário e avaliação semanal — evita que um aluno
// registre "hoje"/"esta semana" fora da data real.
const todayKey = () => new Date().toISOString().slice(0, 10);
const currentWeekKey = () => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffToMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
};

const ownerOrAdmin = async (userId: string, organizationId: string) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership || !["owner", "admin", "manager"].includes(membership.membership.role)) throw new Error("You do not have permission to manage this organization");
  return membership;
};

const hasOrganizationAccess = async (userId: string, organizationId: string) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership) throw new Error("Organization access denied");
  return membership;
};

const STAFF_ROLES: readonly string[] = ["owner", "admin", "manager", "professional", "nutricionista"];
const MANAGER_ROLES: readonly string[] = ["owner", "admin", "manager"];
// CLAUDE.md §2: "Profissional de treino" não publica plano alimentar; "Nutricionista" não publica prescrição de treino.
const TREINO_BLOCKED_ROLES: readonly string[] = ["nutricionista"];
const DIETA_BLOCKED_ROLES: readonly string[] = ["professional"];

const assertStaffOfOrganization = async (userId: string, organizationId: string, blockedRoles: readonly string[] = []) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership || membership.membership.status !== "active" || !STAFF_ROLES.includes(membership.membership.role)) throw new Error("Você não tem acesso a esta organização.");
  if (blockedRoles.includes(membership.membership.role)) throw new Error("Seu papel de equipe não tem permissão para esta ação.");
  return membership;
};

const assertStaffForAluno = async (userId: string, alunoId: string, blockedRoles: readonly string[] = []) => {
  const profile = await getProfileByUserId(alunoId);
  if (!profile?.organization_id) throw new Error("Aluno sem organização vinculada.");
  await assertStaffOfOrganization(userId, profile.organization_id, blockedRoles);
  return profile;
};

const assertStaffForTreino = async (userId: string, treinoId: string, blockedRoles: readonly string[] = []) => {
  const treino = await getTreino(treinoId);
  if (!treino) throw new Error("Treino não encontrado.");
  if (!treino.organization_id) throw new Error("Treino sem organização vinculada.");
  await assertStaffOfOrganization(userId, treino.organization_id, blockedRoles);
  return treino;
};

const assertStaffForDieta = async (userId: string, dietaId: string, blockedRoles: readonly string[] = []) => {
  const dieta = await getDieta(dietaId);
  if (!dieta) throw new Error("Plano alimentar não encontrado.");
  if (!dieta.organization_id) throw new Error("Plano alimentar sem organização vinculada.");
  await assertStaffOfOrganization(userId, dieta.organization_id, blockedRoles);
  return dieta;
};

const assertStaffForAtendimento = async (userId: string, atendimentoId: string) => {
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) throw new Error("Atendimento não encontrado.");
  await assertStaffOfOrganization(userId, atendimento.organization_id);
  return atendimento;
};

// CRM de vendas é operação comercial — o CLAUDE.md (§2) não dá a
// "Profissional de treino" nem a "Nutricionista" acesso a essa área, só a
// membros atribuídos/avaliações/treinos e atendimento nutricional. Por
// isso o CRM usa o corte de MANAGER_ROLES (owner/admin/manager), o mesmo
// já usado em Gestão, em vez do STAFF_ROLES genérico.
const assertManagerOfOrganization = async (userId: string, organizationId: string) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership || membership.membership.status !== "active" || !MANAGER_ROLES.includes(membership.membership.role)) throw new Error("Você não tem acesso ao CRM desta organização.");
  return membership;
};

const assertManagerForLead = async (userId: string, leadId: string) => {
  const lead = await getLead(leadId);
  if (!lead) throw new Error("Lead não encontrado.");
  await assertManagerOfOrganization(userId, lead.organization_id);
  return lead;
};

const assertStaffForTurma = async (userId: string, turmaId: string) => {
  const turma = await getTurma(turmaId);
  if (!turma) throw new Error("Turma não encontrada.");
  await assertStaffOfOrganization(userId, turma.organization_id);
  return turma;
};

const assertAlunoSameOrgAsTurma = async (userId: string, turmaId: string) => {
  const turma = await getTurma(turmaId);
  if (!turma) throw new Error("Turma não encontrada.");
  const profile = await getProfileByUserId(userId);
  if (!profile?.organization_id || profile.organization_id !== turma.organization_id) throw new Error("Turma não encontrada.");
  return turma;
};

const treinoExercicioItem = z.object({ exercicio_id: z.string().uuid(), series: z.number().int().min(1).default(3), repeticoes: z.string().trim().min(1).default("12"), descanso_seg: z.number().int().min(0).default(60), descanso_por_serie: z.string().trim().optional(), observacoes: z.string().trim().optional() });

const acolhimentoInput = z.object({
  rotina_diaria: z.string().trim().max(4000).optional(),
  experiencias_exercicio: z.string().trim().max(4000).optional(),
  experiencias_gostou: z.string().trim().max(4000).optional(),
  experiencias_nao_gostou: z.string().trim().max(4000).optional(),
  dores_lesoes: z.string().trim().max(4000).optional(),
  medicamentos: z.string().trim().max(4000).optional(),
  tempo_disponivel: z.string().trim().max(4000).optional(),
  estilo_treino: z.string().trim().max(4000).optional(),
  exercicios_nao_gosta: z.string().trim().max(4000).optional(),
  alimentos_gosta: z.string().trim().max(4000).optional(),
  alimentos_nao_gosta: z.string().trim().max(4000).optional(),
  alimentacao_rotina: z.string().trim().max(4000).optional(),
});

// LGPD art. 11: dado de saúde exige consentimento específico e destacado —
// nunca o mesmo "aceito os termos" genérico usado para o resto do cadastro.
const HEALTH_DATA_FIELDS = ["dores_lesoes", "medicamentos"] as const;
const requestMeta = (req: { ip?: string; headers: Record<string, unknown> }) => ({ ipAddress: req.ip, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined });

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(SUPABASE_ACCESS_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    signIn: publicProcedure.input(z.object({ email: z.string().email(), password: z.string().min(8) })).mutation(async ({ ctx, input }) => {
      assertRateLimit(rateLimitKey(ctx.req, "signin"), 10, 5 * 60 * 1000);
      const result = await signInWithSupabase(input.email, input.password);
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, result.accessToken, { ...getSessionCookieOptions(ctx.req), maxAge: 1000 * 60 * 60 * 24 * 30 });
      return result;
    }),
    recoverPassword: publicProcedure.input(z.object({ email: z.string().email() })).mutation(({ ctx, input }) => {
      assertRateLimit(rateLimitKey(ctx.req, "recover-password"), 5, 15 * 60 * 1000);
      return createPasswordRecoveryCode(normalizeEmail(input.email));
    }),
    setPassword: publicProcedure.input(z.object({ email: z.string().email(), code: z.string().trim().min(4), password: z.string().min(8) })).mutation(async ({ ctx, input }) => {
      assertRateLimit(rateLimitKey(ctx.req, "set-password"), 10, 15 * 60 * 1000);
      const session = await verifyPasswordRecoveryCode(input.email, input.code);
      const supabaseUser = await updateSupabaseUserPassword(session.access_token, input.password);
      const appUser = supabaseUser.email ? await findAppUserByEmail(normalizeEmail(supabaseUser.email)) : null;
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, session.access_token, { ...getSessionCookieOptions(ctx.req), maxAge: 1000 * 60 * 60 * 24 * 30 });
      return { accessToken: session.access_token, user: supabaseUser, appUser };
    }),
    changePassword: protectedProcedure.input(z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(8) })).mutation(async ({ ctx, input }) => {
      if (!ctx.user.email) throw new Error("Conta sem e-mail associado.");
      if (!ctx.accessToken) throw new Error("Sessão inválida. Faça login novamente.");
      await signInWithSupabase(ctx.user.email, input.currentPassword);
      await updateSupabaseUserPassword(ctx.accessToken, input.newPassword);
      return { success: true } as const;
    }),
  }),
  admin: router({
    status: publicProcedure.query(() => ({ configured: hasSupabaseConfig() })),
    // admin.users/students/lookupCnpj cadastram, editam e excluem clientes
    // do SaaS (inclusive outros Super Admins) — restrito a adminProcedure.
    // Estavam em publicProcedure (sem login nenhum) até esta auditoria.
    lookupCnpj: adminProcedure.input(z.object({ cnpj: z.string().min(14).max(18) })).mutation(({ input }) => lookupCnpj(input.cnpj)),
    users: router({
      list: adminProcedure.query(() => listAppUsers()),
      create: adminProcedure.input(z.object({ name: z.string().trim().min(2), email: z.string().email(), username: z.string().trim().min(2).max(80), module: z.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z.string().trim().min(2), status: z.enum(["Ativo", "Suspenso"]), logoUrl: z.string().max(1000000).optional().nullable(), profileData: z.record(z.string(), z.string()).optional() })).mutation(({ input }) => createAppUser({ ...input, profile_data: input.profileData, email: normalizeEmail(input.email) })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ name: z.string().trim().min(2), email: z.string().email(), username: z.string().trim().min(2), module: z.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z.string().trim().min(2), status: z.enum(["Ativo", "Suspenso"]), logoUrl: z.string().max(1000000).optional().nullable(), profileData: z.record(z.string(), z.string()).optional() }) })).mutation(({ input }) => updateAppUser(input.id, { ...input.data, profile_data: input.data.profileData, email: normalizeEmail(input.data.email) })),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteAppUser(input.id)),
      uploadLogo: adminProcedure.input(z.object({ contentType: z.string(), dataBase64: z.string() })).mutation(async ({ input }) => {
        const buffer = decodeUpload(input.dataBase64, input.contentType, LOGO_MIME_TYPES, LOGO_MAX_BYTES);
        const url = await uploadPublicFile("avatars", `logos/${randomUUID()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
        return { url };
      }),
    }),
    students: router({
      list: adminProcedure.query(() => listAppStudents()),
      create: adminProcedure.input(z.object({ name: z.string().trim().min(2), academy: z.string().trim().min(2), plan: z.string().trim().min(2), status: z.enum(["Ativo", "Inativo"]) })).mutation(({ input }) => createAppStudent(input)),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ name: z.string().trim().min(2), academy: z.string().trim().min(2), plan: z.string().trim().min(2), status: z.enum(["Ativo", "Inativo"]) }) })).mutation(({ input }) => updateAppStudent(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteAppStudent(input.id)),
    }),
  }),
  globalLibrary: router({
    list: adminProcedure.query(() => listGlobalLibrary()),
    // Aprovação em lote dos rascunhos gerados por scripts/seed-acervo.ts
    // (ou por qualquer cadastro manual futuro que nasça como rascunho):
    // o Admin Arke revisa e decide o que publica — a IA nunca publica
    // nada por conta própria.
    publish: adminProcedure.input(z.object({ exerciseIds: z.array(z.string().uuid()).default([]), templateIds: z.array(z.string().uuid()).default([]), nutritionPlanIds: z.array(z.string().uuid()).default([]) })).mutation(async ({ ctx, input }) => {
      const [exercises, templates, nutritionPlans] = await Promise.all([
        publishGlobalExercises(input.exerciseIds, ctx.user.id),
        publishGlobalTemplates(input.templateIds, ctx.user.id),
        publishGlobalNutritionPlans(input.nutritionPlanIds, ctx.user.id),
      ]);
      return { exercises, templates, nutritionPlans };
    }),
    exercises: router({
      create: adminProcedure.input(z.object({ nome: z.string().trim().min(2), grupo_muscular: z.string().trim().min(2), descricao: z.string().trim().optional(), instrucoes: z.string().trim().optional(), video_url: z.string().url().optional(), imagem_url: z.string().url().optional(), equipamento: z.string().trim().optional() })).mutation(({ ctx, input }) => createGlobalExercise({ ...input, created_by: ctx.user.id })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ nome: z.string().trim().min(2), grupo_muscular: z.string().trim().min(2), descricao: z.string().trim().optional().nullable(), instrucoes: z.string().trim().optional().nullable(), video_url: z.string().url().optional().nullable(), imagem_url: z.string().url().optional().nullable(), equipamento: z.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalExercise(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalExercise(input.id)),
      uploadVideo: adminProcedure.input(z.object({ contentType: z.string(), dataBase64: z.string() })).mutation(async ({ input }) => {
        const buffer = decodeUpload(input.dataBase64, input.contentType, EXERCICIO_VIDEO_MIME_TYPES, EXERCICIO_VIDEO_MAX_BYTES);
        const url = await uploadPublicFile("exercicio-videos", `${randomUUID()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
        return { url };
      }),
    }),
    groups: router({
      create: adminProcedure.input(z.object({ nome: z.string().trim().min(2), ordem: z.number().int().min(0).default(0) })).mutation(({ input }) => createGlobalGroup(input)),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ nome: z.string().trim().min(2), ordem: z.number().int().min(0) }) })).mutation(({ input }) => updateGlobalGroup(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalGroup(input.id)),
    }),
    templates: router({
      create: adminProcedure.input(z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim().default(""), descricao: z.string().trim().optional(), divisoes: z.array(z.string().trim().min(1)).min(1) })).mutation(({ ctx, input }) => createGlobalTemplate({ ...input, criado_por: ctx.user.id })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim(), descricao: z.string().trim().optional().nullable(), divisoes: z.array(z.string().trim().min(1)).min(1) }) })).mutation(({ input }) => updateGlobalTemplate(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalTemplate(input.id)),
    }),
    templateExercises: router({
      create: adminProcedure.input(z.object({ template_id: z.string().uuid(), divisao: z.string().trim().min(1), exercicio_id: z.string().uuid(), ordem: z.number().int().min(0).default(0), series: z.number().int().min(1).default(3), repeticoes: z.string().trim().min(1).default("12"), descanso_seg: z.number().int().min(0).default(60), descanso_por_serie: z.string().trim().optional(), observacoes: z.string().trim().optional() })).mutation(({ input }) => createGlobalTemplateExercise(input)),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ divisao: z.string().trim().min(1), exercicio_id: z.string().uuid(), ordem: z.number().int().min(0), series: z.number().int().min(1), repeticoes: z.string().trim().min(1), descanso_seg: z.number().int().min(0), descanso_por_serie: z.string().trim().optional().nullable(), observacoes: z.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalTemplateExercise(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalTemplateExercise(input.id)),
    }),
    nutritionPlans: router({
      create: adminProcedure.input(z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim().default(""), objetivo: z.string().trim().optional(), descricao: z.string().trim().optional(), instrucoes: z.string().trim().optional() })).mutation(({ ctx, input }) => createGlobalNutritionPlan({ ...input, criado_por: ctx.user.id })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim(), objetivo: z.string().trim().optional().nullable(), descricao: z.string().trim().optional().nullable(), instrucoes: z.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalNutritionPlan(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalNutritionPlan(input.id)),
    }),
    routines: router({
      create: adminProcedure.input(z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim().default(""), descricao: z.string().trim().optional(), rotina: z.string().trim().min(2) })).mutation(({ ctx, input }) => createGlobalRoutine({ ...input, criado_por: ctx.user.id })),
      update: adminProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ titulo: z.string().trim().min(2), categoria: z.string().trim(), descricao: z.string().trim().optional().nullable(), rotina: z.string().trim().min(2) }) })).mutation(({ input }) => updateGlobalRoutine(input.id, input.data)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalRoutine(input.id)),
    }),
    // Fase 16 (CLAUDE.md §9): agente de IA curador do acervo. Só produz
    // rascunhos — o Admin revisa no formulário e decide se cadastra; nunca
    // grava direto no acervo.
    ai: router({
      status: adminProcedure.query(() => ({ configured: openaiConfigured() })),
      sugerirExercicio: adminProcedure.input(z.object({ nome: z.string().trim().min(2), grupoMuscular: z.string().trim().min(2), equipamento: z.string().trim().optional() })).mutation(({ input }) => sugerirExercicio(input)),
      sugerirModeloTreino: adminProcedure.input(z.object({ objetivo: z.string().trim().min(2), categoria: z.string().trim().min(1), divisoes: z.array(z.string().trim().min(1)).min(1) })).mutation(({ input }) => sugerirModeloTreino(input)),
    }),
    accessRules: router({
      upsert: adminProcedure.input(z.object({ modulo: z.enum(["academia", "studio", "profissional", "nutricionista"]), plano: z.string().trim().min(2), habilitado: z.boolean(), requer_consultoria: z.boolean().default(true) })).mutation(({ input }) => upsertGlobalAccessRule(input)),
      delete: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => deleteGlobalAccessRule(input.id)),
    }),
  }),
  billing: router({
    // Sem dado sensível — só diz se a chave está configurada e se aponta
    // para sandbox ou produção. Mantido público para a tela de
    // Integrações mostrar o status sem exigir login.
    asaasStatus: publicProcedure.query(() => ({ configured: asaasConfigured(), environment: asaasEnvironment() })),
    // Dados da conta Asaas real e ações que criam cobrança/reconfiguram o
    // webhook: restrito ao Administrador Arke (adminProcedure). Antes
    // disso eram publicProcedure — qualquer pessoa sem login podia criar
    // cobrança arbitrária na conta Asaas real ou trocar o webhook.
    admin: router({
      account: adminProcedure.query(() => getAsaasAccount()),
      payments: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => listAsaasPayments(input?.limit ?? 20)),
      createWebhook: adminProcedure.input(z.object({ url: z.string().url(), email: z.string().email() })).mutation(({ input }) => createAsaasWebhook(input)),
    }),
    // Cobrança real por organização — isolada: cada organização só vê e
    // gera cobrança para si mesma (verificado no servidor, não só
    // escondido na tela).
    organization: router({
      payments: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return listAsaasPaymentsForOrganization(input.organizationId); }),
      gerarCobranca: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), billingType: z.enum(["PIX", "BOLETO", "CREDIT_CARD"]) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const payment = await createSubscriptionCharge({ organizationId: input.organizationId, billingType: input.billingType });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "asaas_payment", entityId: payment.id, afterJson: { billingType: input.billingType, value: payment.value } });
        return payment;
      }),
    }),
  }),
  // Fases 14/15 (CLAUDE.md §9): benefícios (Wellhub/TotalPass) e catraca —
  // credenciais que a própria organização informa (o parceiro real é a
  // academia/studio, não a Arke). Restrito a owner/admin, nunca devolve
  // segredo em claro (ver server/integrations.ts).
  integracoes: router({
    beneficios: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return listBenefitIntegrations(input.organizationId); }),
      save: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), provider: z.enum(["wellhub", "totalpass"]), enabled: z.boolean().default(true), fields: z.record(z.string(), z.string()) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await saveBenefitIntegration({ organizationId: input.organizationId, provider: input.provider, fields: input.fields, enabled: input.enabled });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "benefit_integration", afterJson: { provider: input.provider, enabled: input.enabled } });
        return result;
      }),
    }),
    catraca: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return listTurnstileIntegrationsForOrganization(input.organizationId); }),
      save: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), unitId: z.string().uuid(), brand: z.enum(["control_id", "topdata", "henry", "dimep", "outra"]), model: z.string().trim().max(120).optional(), config: z.record(z.string(), z.string()), enabled: z.boolean().default(true) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await saveTurnstileIntegration(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "updated", entity: "turnstile_integration", afterJson: { brand: input.brand, model: input.model } });
        return result;
      }),
      delete: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), unitId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await deleteTurnstileIntegration(input.unitId, input.organizationId);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "deleted", entity: "turnstile_integration" });
        return result;
      }),
    }),
  }),
  saas: router({
    organizations: router({
      bySlug: publicProcedure.input(z.object({ slug: z.string().trim().toLowerCase().min(1).max(120) })).query(({ input }) => getOrganizationBySlug(input.slug)),
      list: protectedProcedure.query(({ ctx }) => getOrganizationsForUser(ctx.user.id)),
      // create_organization_with_owner (security definer) dá ao p_user_id
      // membership 'owner' de uma organização nova para qualquer client_id
      // que o chamador escolher. Isso é o próprio onboarding (só o Admin
      // Arke implanta um cliente novo) — nunca uma ação de usuário comum.
      // Estava em protectedProcedure: qualquer aluno/profissional logado
      // podia criar organização para o client_id de outra pessoa e virar
      // owner dela. Restrito a adminProcedure nesta auditoria.
      create: adminProcedure.input(z.object({ clientId: z.string().uuid(), module: z.string().trim().min(2).optional(), logoUrl: z.string().max(1000000).optional(), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), name: z.string().trim().min(2).max(160), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), plan: z.enum(SAAS_PLAN_KEYS) })).mutation(({ ctx, input }) => createOrganizationWithOwner({ userId: ctx.user.id, ...input })),
      access: protectedProcedure.input(organizationIdInput).query(({ ctx, input }) => getOrganizationAccess(ctx.user.id, input.organizationId)),
      audit: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return getAuditLogs(input.organizationId, 100, auditFilters(input)); }),
      auditCsv: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return { filename: `arke-auditoria-${input.organizationId}.csv`, content: auditLogsToCsv(await getAuditLogs(input.organizationId, 500, auditFilters(input))) }; }),
      auditPdf: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return { filename: `arke-auditoria-${input.organizationId}.pdf`, contentBase64: auditLogsToPdfBase64(await getAuditLogs(input.organizationId, 500, auditFilters(input))) }; }),
      pendingInvitations: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return getPendingOrganizationInvitations(input.organizationId); }),
      createUnit: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(2).max(160), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), city: z.string().trim().max(120).optional() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const unit = await createOrganizationUnit(input); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: unit.id, action: "created", entity: "organization_unit", entityId: unit.id, afterJson: input }); return unit; }),
      archiveUnit: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), unitId: z.string().uuid() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await archiveOrganizationUnit(input.organizationId, input.unitId); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "archived", entity: "organization_unit", entityId: input.unitId, afterJson: result }); return result; }),
      subscription: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return getOrganizationSubscription(input.organizationId); }),
      updateProfile: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(2).max(160), logoUrl: z.string().max(1000000).optional(), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return updateOrganizationProfile(input); }),
      updateSubscription: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), plan: z.enum(SAAS_PLAN_KEYS), status: z.enum(["trialing", "active", "past_due", "canceled"]).optional() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await updateOrganizationSubscription(input); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "subscription", afterJson: input }); return result; }),
      onboarding: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await hasOrganizationAccess(ctx.user.id, input.organizationId); return getOrganizationOnboarding(input.organizationId); }),
      saveOnboarding: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), currentStep: z.number().int().min(1).max(4), status: z.enum(["not_started", "in_progress", "completed"]), city: z.string().trim().max(120).optional(), defaultUnitName: z.string().trim().min(2).max(160).optional(), inviteEmail: z.string().email().optional(), logoUrl: z.string().url().max(512).optional(), primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await saveOrganizationOnboarding(input); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "onboarding_branding", afterJson: input }); return result; }),
      updatePolicy: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), unitId: z.string().uuid(), role: roleName, module: moduleName, canView: z.boolean(), canManage: z.boolean() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await updateModulePolicy(input); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "updated", entity: "module_policy", afterJson: input }); return result; }),
      invite: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), email: z.string().email(), role: z.enum(["admin", "manager", "professional", "nutricionista", "viewer"]) })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const rawToken = randomUUID(); const tokenHash = createHash("sha256").update(rawToken).digest("hex"); const invitation = await createOrganizationInvitation({ ...input, invitedByUserId: ctx.user.id, email: input.email.toLowerCase(), tokenHash, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 72) }); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "invitation", entityId: invitation.id, afterJson: { email: input.email.toLowerCase(), role: input.role } }); return { invitationId: invitation.id, token: rawToken, status: "pending" as const }; }),
      revokeInvitation: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), invitationId: z.string().uuid() })).mutation(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); const result = await revokeOrganizationInvitation(input.invitationId, input.organizationId); await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "revoked", entity: "invitation", entityId: input.invitationId }); return result; }),
      acceptInvite: protectedProcedure.input(z.object({ token: z.string().min(16).max(128), consentTermos: z.literal(true) })).mutation(async ({ ctx, input }) => {
        assertRateLimit(rateLimitKey(ctx.req, "accept-team-invite"), 10, 15 * 60 * 1000);
        if (!ctx.user.email) throw new Error("Authenticated user email is required");
        const result = await acceptOrganizationInvitation({ tokenHash: createHash("sha256").update(input.token).digest("hex"), userId: ctx.user.id, email: ctx.user.email });
        if (!(await hasConsent(ctx.user.id, "termos_uso_privacidade"))) {
          const policy = await getCurrentPrivacyPolicy();
          await recordConsent({ userId: ctx.user.id, consentType: "termos_uso_privacidade", policyVersionId: policy?.id ?? null, ...requestMeta(ctx.req) });
        }
        await recordAuditLog({ organizationId: result.organizationId, userId: ctx.user.id, action: "accepted", entity: "invitation", entityId: result.invitation.id, afterJson: { role: result.role, email: ctx.user.email } });
        return { organizationId: result.organizationId, role: result.role, status: "accepted" as const };
      }),
      listDeletionRequests: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return listDeletionRequests(input.organizationId); }),
      fulfillDeletionRequest: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), requestId: z.string().uuid(), note: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const deletionRequest = await getDeletionRequest(input.requestId);
        if (!deletionRequest || deletionRequest.organization_id !== input.organizationId || deletionRequest.status !== "pending" || !deletionRequest.user_id) throw new Error("Solicitação não encontrada ou já resolvida.");
        await fulfillDeletionRequest({ requestId: input.requestId, alunoId: deletionRequest.user_id, resolvedBy: ctx.user.id, note: input.note });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "completed", entity: "data_deletion_request", entityId: input.requestId });
        return { requestId: input.requestId, status: "completed" as const };
      }),
      rejectDeletionRequest: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), requestId: z.string().uuid(), note: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const rejected = await rejectDeletionRequest({ requestId: input.requestId, organizationId: input.organizationId, resolvedBy: ctx.user.id, note: input.note });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "rejected", entity: "data_deletion_request", entityId: input.requestId });
        return rejected;
      }),
      // Módulo Arke (CLAUDE.md §3/§8): licença de organização — habilita a
      // ACADEMIA a oferecer o método aos próprios alunos. O pacote (99/249/499)
      // segue o mesmo tier do plano-base da organização; alunos individuais
      // só ficam "com Arke" via arke.membership.toggle, e só se isto aqui
      // estiver habilitado.
      arkeModule: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        const [organization, arkeModule, alunosAtivos] = await Promise.all([getOrganization(input.organizationId), getArkeModule(input.organizationId), countAlunosComArkeAtivo(input.organizationId)]);
        return { plan: organization?.plan ?? null, module: arkeModule, alunosAtivos };
      }),
      updateArkeModule: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const organization = await getOrganization(input.organizationId);
        if (!organization) throw new Error("Organização não encontrada.");
        if (!(ORG_PLAN_KEYS as readonly string[]).includes(organization.plan)) throw new Error("Módulo Arke disponível apenas para planos de Academia/Studio.");
        const packageTier = organization.plan as OrgPlan;
        const result = await upsertArkeModule({ organizationId: input.organizationId, enabled: input.enabled, packageTier, amountCents: input.enabled ? ARKE_MODULE_PACKAGE_AMOUNTS_CENTS[packageTier] : null });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "arke_module", afterJson: input });
        return result;
      }),
    }),
  }),
  prescricao: router({
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => STAFF_ROLES.includes(item.membership.role))),
    students: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await assertStaffOfOrganization(ctx.user.id, input.organizationId); return listStudentsInOrganization(input.organizationId); }),
    updateMatricula: protectedProcedure.input(z.object({ alunoId: z.string().uuid(), unitId: z.string().uuid().nullable().optional(), matriculaEm: z.string().datetime().nullable().optional() })).mutation(async ({ ctx, input }) => { await assertStaffForAluno(ctx.user.id, input.alunoId); return updateStudentMatricula(input.alunoId, { unitId: input.unitId, matriculaEm: input.matriculaEm }); }),
    exercises: protectedProcedure.query(() => listExercisesCatalog()),
    treinos: router({
      list: protectedProcedure.input(z.object({ alunoId: z.string().uuid() })).query(async ({ ctx, input }) => { await assertStaffForAluno(ctx.user.id, input.alunoId); return listTreinosForAluno(input.alunoId); }),
      exercicios: protectedProcedure.input(z.object({ treinoId: z.string().uuid() })).query(async ({ ctx, input }) => { await assertStaffForTreino(ctx.user.id, input.treinoId); return listTreinoExercicios(input.treinoId); }),
      create: protectedProcedure.input(z.object({ alunoId: z.string().uuid(), titulo: z.string().trim().min(2), tipo: z.string().trim().min(1).default("A"), descricao: z.string().trim().optional() })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId, TREINO_BLOCKED_ROLES);
        const treino = await createTreino({ aluno_id: input.alunoId, titulo: input.titulo, tipo: input.tipo, descricao: input.descricao || undefined, organization_id: profile.organization_id, criado_por: ctx.user.id });
        if (profile.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "created", entity: "treino", entityId: treino.id, afterJson: input });
        return treino;
      }),
      update: protectedProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ titulo: z.string().trim().min(2), tipo: z.string().trim().min(1), descricao: z.string().trim().optional().nullable() }) })).mutation(async ({ ctx, input }) => {
        const treino = await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        const updated = await updateTreino(input.id, input.data);
        if (treino.organization_id) await recordAuditLog({ organizationId: treino.organization_id, userId: ctx.user.id, action: "updated", entity: "treino", entityId: input.id, beforeJson: treino, afterJson: input.data });
        return updated;
      }),
      saveExercicios: protectedProcedure.input(z.object({ treinoId: z.string().uuid(), items: z.array(treinoExercicioItem) })).mutation(async ({ ctx, input }) => { await assertStaffForTreino(ctx.user.id, input.treinoId, TREINO_BLOCKED_ROLES); return replaceTreinoExercicios(input.treinoId, input.items); }),
      publish: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const treino = await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        const published = await publishTreino(input.id, ctx.user.id);
        if (treino.organization_id) await recordAuditLog({ organizationId: treino.organization_id, userId: ctx.user.id, action: "published", entity: "treino", entityId: input.id, afterJson: { versao: published.versao } });
        return published;
      }),
      delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const treino = await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        const result = await deleteTreino(input.id);
        if (treino.organization_id) await recordAuditLog({ organizationId: treino.organization_id, userId: ctx.user.id, action: "deleted", entity: "treino", entityId: input.id, beforeJson: treino });
        return result;
      }),
      fichaPdf: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => { await assertStaffForTreino(ctx.user.id, input.id); return gerarFichaTreinoPdf(input.id); }),
    }),
    dietas: router({
      list: protectedProcedure.input(z.object({ alunoId: z.string().uuid() })).query(async ({ ctx, input }) => { await assertStaffForAluno(ctx.user.id, input.alunoId); return listDietasForAluno(input.alunoId); }),
      create: protectedProcedure.input(z.object({ alunoId: z.string().uuid(), titulo: z.string().trim().min(2), descricao: z.string().trim().optional(), arquivoUrl: z.string().url().optional() })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId, DIETA_BLOCKED_ROLES);
        const dieta = await createDieta({ aluno_id: input.alunoId, titulo: input.titulo, descricao: input.descricao || undefined, arquivo_url: input.arquivoUrl || undefined, organization_id: profile.organization_id, criado_por: ctx.user.id });
        if (profile.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "created", entity: "dieta", entityId: dieta.id, afterJson: input });
        return dieta;
      }),
      uploadArquivo: protectedProcedure.input(z.object({ alunoId: z.string().uuid(), contentType: z.string(), dataBase64: z.string() })).mutation(async ({ ctx, input }) => {
        await assertStaffForAluno(ctx.user.id, input.alunoId, DIETA_BLOCKED_ROLES);
        const buffer = decodeUpload(input.dataBase64, input.contentType, DIETA_MIME_TYPES, DIETA_MAX_BYTES);
        const url = await uploadPublicFile("dietas", `${input.alunoId}/${randomUUID()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
        return { url };
      }),
      update: protectedProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ titulo: z.string().trim().min(2), descricao: z.string().trim().optional().nullable(), arquivo_url: z.string().url().optional().nullable() }) })).mutation(async ({ ctx, input }) => {
        const dieta = await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        const updated = await updateDieta(input.id, input.data);
        if (dieta.organization_id) await recordAuditLog({ organizationId: dieta.organization_id, userId: ctx.user.id, action: "updated", entity: "dieta", entityId: input.id, beforeJson: dieta, afterJson: input.data });
        return updated;
      }),
      publish: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const dieta = await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        const published = await publishDieta(input.id, ctx.user.id);
        if (dieta.organization_id) await recordAuditLog({ organizationId: dieta.organization_id, userId: ctx.user.id, action: "published", entity: "dieta", entityId: input.id, afterJson: { versao: published.versao } });
        return published;
      }),
      delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const dieta = await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        const result = await deleteDieta(input.id);
        if (dieta.organization_id) await recordAuditLog({ organizationId: dieta.organization_id, userId: ctx.user.id, action: "deleted", entity: "dieta", entityId: input.id, beforeJson: dieta });
        return result;
      }),
    }),
    meu: router({
      treinos: protectedProcedure.query(({ ctx }) => listTreinosForAluno(ctx.user.id, true)),
      treinoExercicios: protectedProcedure.input(z.object({ treinoId: z.string().uuid() })).query(async ({ ctx, input }) => { const treino = await getTreino(input.treinoId); if (!treino || treino.aluno_id !== ctx.user.id || treino.estado_publicacao !== "publicado") throw new Error("Treino não encontrado."); return listTreinoExercicios(input.treinoId); }),
      dietas: protectedProcedure.query(({ ctx }) => listDietasForAluno(ctx.user.id, true)),
      fichaPdf: protectedProcedure.input(z.object({ treinoId: z.string().uuid() })).query(async ({ ctx, input }) => { const treino = await getTreino(input.treinoId); if (!treino || treino.aluno_id !== ctx.user.id || treino.estado_publicacao !== "publicado") throw new Error("Treino não encontrado."); return gerarFichaTreinoPdf(input.treinoId); }),
    }),
  }),
  arke: router({
    membership: router({
      status: protectedProcedure.input(z.object({ alunoId: z.string().uuid() })).query(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        if (!profile.organization_id) return { ativo: false, moduleEnabled: false };
        const [licenca, arkeModule] = await Promise.all([getAlunoArkeLicenca(input.alunoId, profile.organization_id), getArkeModule(profile.organization_id)]);
        return { ativo: licenca?.ativo ?? false, moduleEnabled: arkeModule?.enabled ?? false };
      }),
      toggle: protectedProcedure.input(z.object({ alunoId: z.string().uuid(), ativo: z.boolean() })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        if (!profile.organization_id) throw new Error("Aluno sem organização vinculada.");
        if (input.ativo) {
          const arkeModule = await getArkeModule(profile.organization_id);
          if (!arkeModule?.enabled) throw new Error("Sua organização ainda não habilitou o módulo Arke.");
        }
        const result = await toggleAlunoArkeLicenca({ userId: input.alunoId, organizationId: profile.organization_id, ativo: input.ativo, ativadoPor: ctx.user.id });
        await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: input.ativo ? "activated" : "deactivated", entity: "aluno_arke_licenca", entityId: input.alunoId });
        return result;
      }),
    }),
    // Conteúdo do método propriamente dito (Fase 1c) — cada procedure exige
    // assertAlunoTemArke antes de ler/escrever, então nunca vaza pra quem
    // não tem o módulo ativo, mesmo se a UI esconder a seção.
    meu: router({
      temArke: protectedProcedure.query(({ ctx }) => alunoTemArke(ctx.user.id)),
      checkinHoje: protectedProcedure.query(async ({ ctx }) => { await assertAlunoTemArke(ctx.user.id); return getCheckinDoDia(ctx.user.id, todayKey()); }),
      registrarCheckin: protectedProcedure.input(z.object({ dedicacao: z.enum(["baixa", "media", "boa", "excelente"]) })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organização vinculada.");
        return upsertCheckinDiario({ userId: ctx.user.id, organizationId: profile.organization_id, data: todayKey(), dedicacao: input.dedicacao });
      }),
      avaliacaoSemanaAtual: protectedProcedure.query(async ({ ctx }) => { await assertAlunoTemArke(ctx.user.id); return getAvaliacaoSemanal(ctx.user.id, currentWeekKey()); }),
      registrarAvaliacaoSemanal: protectedProcedure.input(z.object({ sono: z.number().int().min(1).max(10), produtividade: z.number().int().min(1).max(10), humor: z.number().int().min(1).max(10), conquista: z.string().trim().max(1000).optional() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organização vinculada.");
        return upsertAvaliacaoSemanal({ userId: ctx.user.id, organizationId: profile.organization_id, semana: currentWeekKey(), ...input });
      }),
      planoTreinoSemanal: protectedProcedure.query(async ({ ctx }) => { await assertAlunoTemArke(ctx.user.id); return getPlanoTreinoSemanal(ctx.user.id); }),
      salvarPlanoTreinoSemanal: protectedProcedure.input(z.object({ diasTreino: z.array(z.string().trim().min(1)).max(7), horarioPreferido: z.string().trim().max(60).optional(), localTreino: z.string().trim().max(160).optional() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organização vinculada.");
        return upsertPlanoTreinoSemanal({ userId: ctx.user.id, organizationId: profile.organization_id, diasTreino: input.diasTreino, horarioPreferido: input.horarioPreferido, localTreino: input.localTreino });
      }),
    }),
  }),
  journey: router({
    inviteMember: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), email: z.string().email(), fullName: z.string().trim().min(2) })).mutation(async ({ ctx, input }) => { await assertStaffOfOrganization(ctx.user.id, input.organizationId); return inviteMember({ organizationId: input.organizationId, invitedByUserId: ctx.user.id, email: input.email, fullName: input.fullName }); }),
    pendingInvitations: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await assertStaffOfOrganization(ctx.user.id, input.organizationId); return listPendingMemberInvitations(input.organizationId); }),
    revokeInvitation: protectedProcedure.input(z.object({ id: z.string().uuid(), organizationId: z.string().uuid() })).mutation(async ({ ctx, input }) => { await assertStaffOfOrganization(ctx.user.id, input.organizationId); return revokeMemberInvitation(input.id, input.organizationId); }),
    acceptInvite: publicProcedure.input(z.object({ token: z.string().trim().min(10), password: z.string().min(8), consentTermos: z.literal(true) })).mutation(async ({ ctx, input }) => {
      assertRateLimit(rateLimitKey(ctx.req, "accept-member-invite"), 10, 15 * 60 * 1000);
      const result = await acceptMemberInvitation(input.token, input.password);
      const policy = await getCurrentPrivacyPolicy();
      await recordConsent({ userId: result.user.id, consentType: "termos_uso_privacidade", policyVersionId: policy?.id ?? null, ...requestMeta(ctx.req) });
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, result.accessToken, { ...getSessionCookieOptions(ctx.req), maxAge: 1000 * 60 * 60 * 24 * 30 });
      return { accessToken: result.accessToken, user: result.user, organizationId: result.organizationId };
    }),
    getCurrentPrivacyPolicy: publicProcedure.query(() => getCurrentPrivacyPolicy()),
    getConsentStatus: protectedProcedure.query(async ({ ctx }) => ({
      termosUsoPrivacidade: await hasConsent(ctx.user.id, "termos_uso_privacidade"),
      dadosSaude: await hasConsent(ctx.user.id, "dados_saude"),
    })),
    myAcolhimento: protectedProcedure.query(({ ctx }) => getAcolhimento(ctx.user.id)),
    submitAcolhimento: protectedProcedure.input(acolhimentoInput.extend({ consentDadosSaude: z.literal(true).optional() })).mutation(async ({ ctx, input }) => {
      const { consentDadosSaude, ...data } = input;
      const touchesHealthData = HEALTH_DATA_FIELDS.some((field) => data[field] !== undefined);
      if (touchesHealthData && !(await hasConsent(ctx.user.id, "dados_saude"))) {
        if (!consentDadosSaude) throw new Error("É necessário consentir com o uso dos seus dados de saúde antes de informar dores, lesões ou medicamentos.");
        const policy = await getCurrentPrivacyPolicy();
        await recordConsent({ userId: ctx.user.id, consentType: "dados_saude", policyVersionId: policy?.id ?? null, ...requestMeta(ctx.req) });
      }
      const saved = await upsertAcolhimento(ctx.user.id, data);
      const profile = await getProfileByUserId(ctx.user.id);
      if (profile?.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "updated", entity: "acolhimento", entityId: ctx.user.id });
      return saved;
    }),
    staffAcolhimento: protectedProcedure.input(z.object({ alunoId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
      const acolhimento = await getAcolhimento(input.alunoId);
      if (profile.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "viewed", entity: "acolhimento", entityId: input.alunoId });
      return acolhimento;
    }),
    requestAccountDeletion: protectedProcedure.input(z.object({ reason: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      return createDeletionRequest({ userId: ctx.user.id, organizationId: profile?.organization_id ?? null, reason: input.reason });
    }),
    myDeletionRequest: protectedProcedure.query(({ ctx }) => getMyDeletionRequest(ctx.user.id)),
  }),
  atendimento: router({
    checkIn: protectedProcedure.input(z.object({ status: z.enum(["indo_bem", "com_dificuldade", "quero_ajuda"]), observacao: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile?.organization_id) throw new Error("Você ainda não está vinculado a uma organização.");
      return submitCheckIn({ alunoId: ctx.user.id, organizationId: profile.organization_id, status: input.status, observacao: input.observacao });
    }),
    meusCheckIns: protectedProcedure.query(({ ctx }) => listMyCheckIns(ctx.user.id)),
    pedirAjuda: protectedProcedure.input(z.object({ descricao: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile?.organization_id) throw new Error("Você ainda não está vinculado a uma organização.");
      return requestHelp({ alunoId: ctx.user.id, organizationId: profile.organization_id, descricao: input.descricao });
    }),
    meusAtendimentos: protectedProcedure.query(({ ctx }) => listMyAtendimentos(ctx.user.id)),
    fila: router({
      list: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), status: z.enum(["aberta", "em_andamento", "resolvida"]).optional() })).query(async ({ ctx, input }) => { await assertStaffOfOrganization(ctx.user.id, input.organizationId); return listAtendimentosForOrganization(input.organizationId, input.status); }),
      create: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), alunoId: z.string().uuid(), prioridade: z.enum(["rotina", "atencao", "prioritario", "encaminhamento_profissional"]), descricao: z.string().trim().max(2000).optional(), prazo: z.string().datetime().optional() })).mutation(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return createAtendimento({ organizationId: input.organizationId, alunoId: input.alunoId, origem: "manual", prioridade: input.prioridade, descricao: input.descricao, criadoPor: ctx.user.id, prazo: input.prazo });
      }),
      assign: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => { await assertStaffForAtendimento(ctx.user.id, input.id); return assignAtendimento(input.id, ctx.user.id); }),
      resolve: protectedProcedure.input(z.object({ id: z.string().uuid(), resultado: z.string().trim().min(2).max(4000) })).mutation(async ({ ctx, input }) => { await assertStaffForAtendimento(ctx.user.id, input.id); return resolveAtendimento(input.id, ctx.user.id, input.resultado); }),
    }),
  }),
  crm: router({
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => MANAGER_ROLES.includes(item.membership.role))),
    indicadores: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), unitId: z.string().uuid().optional() })).query(async ({ ctx, input }) => { await assertManagerOfOrganization(ctx.user.id, input.organizationId); return getCrmIndicadores(input.organizationId, input.unitId); }),
    leads: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await assertManagerOfOrganization(ctx.user.id, input.organizationId); return listLeadsForOrganization(input.organizationId); }),
      create: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), unitId: z.string().uuid().optional(), nome: z.string().trim().min(2).max(160), telefone: z.string().trim().max(40).optional(), email: z.string().email().optional(), origem: z.string().trim().max(80).optional(), interesse: z.string().trim().max(160).optional(), responsavelId: z.string().uuid().optional(), notas: z.string().trim().max(4000).optional() })).mutation(async ({ ctx, input }) => { await assertManagerOfOrganization(ctx.user.id, input.organizationId); return createLead({ organizationId: input.organizationId, unitId: input.unitId, nome: input.nome, telefone: input.telefone, email: input.email, origem: input.origem, interesse: input.interesse, responsavelId: input.responsavelId ?? ctx.user.id, notas: input.notas, criadoPor: ctx.user.id }); }),
      update: protectedProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ nome: z.string().trim().min(2).max(160).optional(), telefone: z.string().trim().max(40).optional().nullable(), email: z.string().email().optional().nullable(), origem: z.string().trim().max(80).optional().nullable(), interesse: z.string().trim().max(160).optional().nullable(), unitId: z.string().uuid().optional().nullable(), responsavelId: z.string().uuid().optional().nullable(), notas: z.string().trim().max(4000).optional().nullable() }) })).mutation(async ({ ctx, input }) => { await assertManagerForLead(ctx.user.id, input.id); return updateLead(input.id, input.data); }),
      delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => { await assertManagerForLead(ctx.user.id, input.id); return deleteLead(input.id); }),
      moverEstagio: protectedProcedure.input(z.object({ id: z.string().uuid(), estagio: z.enum(["novo", "contato_feito", "visita_agendada"]) })).mutation(async ({ ctx, input }) => { await assertManagerForLead(ctx.user.id, input.id); return moverEstagioLead(input.id, input.estagio); }),
      marcarPerdido: protectedProcedure.input(z.object({ id: z.string().uuid(), motivo: z.string().trim().min(2).max(500) })).mutation(async ({ ctx, input }) => { await assertManagerForLead(ctx.user.id, input.id); return marcarLeadPerdido(input.id, input.motivo); }),
      converter: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => { await assertManagerForLead(ctx.user.id, input.id); return converterLead(input.id, ctx.user.id); }),
      atividades: protectedProcedure.input(z.object({ leadId: z.string().uuid() })).query(async ({ ctx, input }) => { await assertManagerForLead(ctx.user.id, input.leadId); return listLeadAtividades(input.leadId); }),
      criarNota: protectedProcedure.input(z.object({ leadId: z.string().uuid(), descricao: z.string().trim().min(2).max(4000) })).mutation(async ({ ctx, input }) => { const lead = await assertManagerForLead(ctx.user.id, input.leadId); return createLeadNota({ leadId: input.leadId, organizationId: lead.organization_id, descricao: input.descricao, criadoPor: ctx.user.id }); }),
    }),
  }),
  gestao: router({
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => MANAGER_ROLES.includes(item.membership.role))),
    indicadores: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await ownerOrAdmin(ctx.user.id, input.organizationId); return getGestaoIndicadores(input.organizationId); }),
  }),
  academia: router({
    frequencia: router({
      registrar: protectedProcedure.input(z.object({ alunoId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        if (!profile.organization_id) throw new Error("Aluno sem organização vinculada.");
        return registrarFrequencia({ alunoId: input.alunoId, organizationId: profile.organization_id, unitId: profile.unit_id ?? undefined, origem: "manual", registradoPor: ctx.user.id });
      }),
      listOrganization: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await assertStaffOfOrganization(ctx.user.id, input.organizationId); return listFrequenciaForOrganization(input.organizationId); }),
      listAluno: protectedProcedure.input(z.object({ alunoId: z.string().uuid() })).query(async ({ ctx, input }) => { await assertStaffForAluno(ctx.user.id, input.alunoId); return listFrequenciaForAluno(input.alunoId); }),
      minhas: protectedProcedure.query(({ ctx }) => listFrequenciaForAluno(ctx.user.id)),
    }),
  }),
  studio: router({
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => STAFF_ROLES.includes(item.membership.role))),
    turmas: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => { await assertStaffOfOrganization(ctx.user.id, input.organizationId); return listTurmasForOrganization(input.organizationId); }),
      create: protectedProcedure.input(z.object({ organizationId: z.string().uuid(), unitId: z.string().uuid().optional(), nome: z.string().trim().min(2), descricao: z.string().trim().optional(), professorId: z.string().uuid().optional(), limiteVagas: z.number().int().min(1).max(500), duracaoMin: z.number().int().min(15).max(480).default(60) })).mutation(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return createTurma({ organization_id: input.organizationId, unit_id: input.unitId || undefined, nome: input.nome, descricao: input.descricao || undefined, professor_id: input.professorId || undefined, limite_vagas: input.limiteVagas, duracao_min: input.duracaoMin, criado_por: ctx.user.id });
      }),
      update: protectedProcedure.input(z.object({ id: z.string().uuid(), data: z.object({ nome: z.string().trim().min(2), descricao: z.string().trim().optional().nullable(), professorId: z.string().uuid().optional().nullable(), limiteVagas: z.number().int().min(1).max(500), duracaoMin: z.number().int().min(15).max(480), status: z.enum(["ativa", "inativa"]) }) })).mutation(async ({ ctx, input }) => {
        await assertStaffForTurma(ctx.user.id, input.id);
        return updateTurma(input.id, { nome: input.data.nome, descricao: input.data.descricao, professor_id: input.data.professorId, limite_vagas: input.data.limiteVagas, duracao_min: input.data.duracaoMin, status: input.data.status });
      }),
      delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => { await assertStaffForTurma(ctx.user.id, input.id); return deleteTurma(input.id); }),
      horarios: protectedProcedure.input(z.object({ turmaId: z.string().uuid() })).query(async ({ ctx, input }) => { await assertStaffForTurma(ctx.user.id, input.turmaId); return listTurmaHorarios(input.turmaId); }),
      saveHorarios: protectedProcedure.input(z.object({ turmaId: z.string().uuid(), items: z.array(z.object({ diaSemana: z.number().int().min(0).max(6), horaInicio: z.string().regex(/^\d{2}:\d{2}$/) })) })).mutation(async ({ ctx, input }) => {
        await assertStaffForTurma(ctx.user.id, input.turmaId);
        return replaceTurmaHorarios(input.turmaId, input.items.map((item) => ({ dia_semana: item.diaSemana, hora_inicio: item.horaInicio })));
      }),
      reservas: protectedProcedure.input(z.object({ turmaId: z.string().uuid(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).query(async ({ ctx, input }) => { await assertStaffForTurma(ctx.user.id, input.turmaId); return listReservasForTurmaData(input.turmaId, input.data); }),
      cancelarReserva: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const reserva = await getReserva(input.id);
        if (!reserva) throw new Error("Reserva não encontrada.");
        await assertStaffOfOrganization(ctx.user.id, reserva.organization_id);
        return cancelarReservaStaff(input.id);
      }),
    }),
    turmasDisponiveis: protectedProcedure.query(async ({ ctx }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile?.organization_id) return [];
      return listTurmasAtivas(profile.organization_id);
    }),
    horariosDaTurma: protectedProcedure.input(z.object({ turmaId: z.string().uuid() })).query(async ({ ctx, input }) => { await assertAlunoSameOrgAsTurma(ctx.user.id, input.turmaId); return listTurmaHorarios(input.turmaId); }),
    vagasDisponiveis: protectedProcedure.input(z.object({ turmaId: z.string().uuid(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).query(async ({ ctx, input }) => { await assertAlunoSameOrgAsTurma(ctx.user.id, input.turmaId); return getVagasDisponiveis(input.turmaId, input.data); }),
    reservar: protectedProcedure.input(z.object({ turmaId: z.string().uuid(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile?.organization_id) throw new Error("Você ainda não está vinculado a uma organização.");
      return reservarVaga({ turmaId: input.turmaId, alunoId: ctx.user.id, organizationId: profile.organization_id, data: input.data });
    }),
    minhasReservas: protectedProcedure.query(({ ctx }) => listMinhasReservas(ctx.user.id)),
    cancelarMinhaReserva: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ ctx, input }) => cancelarReserva(input.id, ctx.user.id)),
  }),
});

export type AppRouter = typeof appRouter;
