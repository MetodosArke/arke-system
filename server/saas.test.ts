import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { auditLogsToCsv, auditLogsToPdfBase64, chargeSetupFeeIfNeeded, getAuditLogs, listActiveStaffUserIds } from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const TEST_USER_ID = "00000000-0000-4000-8000-0000000000a1";
const TEST_ORG_ID = "00000000-0000-4000-8000-0000000000b1";

function createContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: TEST_USER_ID,
    email: "saas@example.com",
    name: "SaaS Test",
    role: "admin",
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("saas.organizations", () => {
  it("returns an organization list through the protected tenant boundary", async () => {
    const result = await appRouter.createCaller(createContext()).saas.organizations.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("rejects a workspace slug that could break tenant routing", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.create({
      name: "Nova Academia",
      slug: "Nova Academia/../../other-tenant",
      plan: "growth",
    })).rejects.toThrow();
  });

  it("rejects policy values outside the explicit access boundary", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.updatePolicy({
      organizationId: TEST_ORG_ID,
      unitId: TEST_ORG_ID,
      // @ts-expect-error role fora do enum aceito, exatamente o que este teste verifica
      role: "superuser",
      module: "financeiro",
      canView: true,
      canManage: false,
    })).rejects.toThrow();
  });

  it("blocks audit history when the user is not a member of the organization", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.audit({ organizationId: TEST_ORG_ID })).rejects.toThrow("Organization access denied");
  });

  it("validates invite tokens and produces downloadable audit formats", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.acceptInvite({ token: "short" })).rejects.toThrow();
    const rows = [{ id: "00000000-0000-0000-0000-0000000000c1", action: "updated", entity: "module_policy", entity_id: TEST_ORG_ID, auth_user_id: TEST_USER_ID, created_at: "2026-09-05T12:00:00Z" }];
    expect(auditLogsToCsv(rows)).toContain("module_policy");
    expect(Buffer.from(auditLogsToPdfBase64(rows), "base64").subarray(0, 8).toString()).toBe("%PDF-1.4");
  });

  it("accepts the combined audit filter shape", async () => {
    const result = await getAuditLogs(TEST_ORG_ID, 10, { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T23:59:59Z"), userId: TEST_USER_ID, entity: "module_policy" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("never throws when charging the setup fee (no-ops without Supabase configured)", async () => {
    await expect(chargeSetupFeeIfNeeded(TEST_ORG_ID)).resolves.toBeUndefined();
  });

  it("returns an empty staff list instead of throwing without Supabase configured", async () => {
    await expect(listActiveStaffUserIds(TEST_ORG_ID, ["owner", "admin"])).resolves.toEqual([]);
  });
});

describe("saas.organizations.arkeModule", () => {
  it("rejects a plan value outside the accepted enum on organization creation", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.create({
      name: "Nova Academia",
      slug: "nova-academia",
      // @ts-expect-error plano antigo removido nas regras comerciais, exatamente o que este teste verifica
      plan: "unlimited",
    })).rejects.toThrow();
  });

  it("requires organization access to read the arke module status", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.arkeModule({ organizationId: TEST_ORG_ID })).rejects.toThrow();
  });

  it("requires owner/admin to update the arke module", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.updateArkeModule({ organizationId: TEST_ORG_ID, enabled: true })).rejects.toThrow();
  });
});

describe("arke.membership", () => {
  it("requires staff access to the aluno's organization to read status", async () => {
    await expect(appRouter.createCaller(createContext()).arke.membership.status({ alunoId: TEST_USER_ID })).rejects.toThrow();
  });

  it("requires staff access to the aluno's organization to toggle", async () => {
    await expect(appRouter.createCaller(createContext()).arke.membership.toggle({ alunoId: TEST_USER_ID, ativo: true })).rejects.toThrow();
  });
});

describe("arke.meu (conteúdo do método)", () => {
  it("cannot check temArke without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.meu.temArke()).rejects.toThrow();
  });

  it("cannot register a check-in without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.meu.registrarCheckin({ dedicacao: "boa" })).rejects.toThrow();
  });

  it("cannot register an avaliação semanal without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.meu.registrarAvaliacaoSemanal({ sono: 5, produtividade: 5, humor: 5 })).rejects.toThrow();
  });

  it("rejects an avaliação semanal value outside the accepted 1-10 range", async () => {
    await expect(appRouter.createCaller(createContext()).arke.meu.registrarAvaliacaoSemanal({ sono: 11, produtividade: 5, humor: 5 })).rejects.toThrow();
  });

  it("cannot save a plano de treino semanal without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.meu.salvarPlanoTreinoSemanal({ diasTreino: ["segunda"] })).rejects.toThrow();
  });

  it("cannot read evolução (progresso) without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.meu.progresso()).rejects.toThrow();
  });
});

describe("arke.feed (Fase 2 — engajamento)", () => {
  it("cannot list the feed without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.feed.list()).rejects.toThrow();
  });

  it("rejects an empty post with no content and no image", async () => {
    await expect(appRouter.createCaller(createContext()).arke.feed.create({ content: "" })).rejects.toThrow("Escreva algo ou adicione uma imagem para publicar.");
  });

  it("cannot create a post without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.feed.create({ content: "Bora treinar!" })).rejects.toThrow();
  });

  it("cannot toggle a like without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.feed.toggleLike({ postId: "00000000-0000-4000-8000-0000000000e1" })).rejects.toThrow();
  });

  it("cannot delete a post without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.feed.delete({ id: "00000000-0000-4000-8000-0000000000e1" })).rejects.toThrow();
  });

  it("cannot comment on a post without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.feed.comments.create({ postId: "00000000-0000-4000-8000-0000000000e1", content: "Boa!" })).rejects.toThrow();
  });

  it("cannot delete a comment without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.feed.comments.delete({ id: "00000000-0000-4000-8000-0000000000e2" })).rejects.toThrow();
  });
});

describe("prescricao.chat", () => {
  it("requires staff access to the aluno's organization to list treino messages", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.chat.treino.list({ alunoId: TEST_USER_ID })).rejects.toThrow();
  });

  it("requires staff access to send a treino message", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.chat.treino.send({ alunoId: TEST_USER_ID, mensagem: "Olá!" })).rejects.toThrow();
  });

  it("requires staff access to the dieta's organization to list dieta messages", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.chat.dieta.list({ dietaId: "00000000-0000-4000-8000-0000000000f3" })).rejects.toThrow();
  });

  it("requires staff access to send a dieta message", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.chat.dieta.send({ dietaId: "00000000-0000-4000-8000-0000000000f3", mensagem: "Olá!" })).rejects.toThrow();
  });
});

describe("prescricao.meu (chat do aluno)", () => {
  it("cannot read chat de treino without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.meu.chatTreino()).rejects.toThrow();
  });

  it("cannot send a chat de treino message without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.meu.sendChatTreino({ mensagem: "Oi!" })).rejects.toThrow();
  });

  it("cannot read chat de dieta for a plano alimentar that is not the caller's", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.meu.chatDieta({ dietaId: "00000000-0000-4000-8000-0000000000f3" })).rejects.toThrow();
  });
});

describe("prescricao.desafios", () => {
  it("requires staff access to the organization to list", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.desafios.list({ organizationId: TEST_ORG_ID })).rejects.toThrow();
  });

  it("requires staff access to the organization to create", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.desafios.create({ organizationId: TEST_ORG_ID, titulo: "Desafio água", tipo: "consumo_agua", dataInicio: "2026-01-01", dataFim: "2026-01-31" })).rejects.toThrow();
  });

  it("rejects a tipo value outside the accepted enum", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.desafios.create({
      organizationId: TEST_ORG_ID,
      titulo: "Desafio inválido",
      // @ts-expect-error tipo fora do enum aceito, exatamente o que este teste verifica
      tipo: "corrida_lunar",
      dataInicio: "2026-01-01",
      dataFim: "2026-01-31",
    })).rejects.toThrow();
  });

  it("requires staff access to update a desafio", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.desafios.update({ id: "00000000-0000-4000-8000-0000000000f1", titulo: "Novo título", tipo: "livre", dataInicio: "2026-01-01", dataFim: "2026-01-31", pontos: 10, paraTodos: true })).rejects.toThrow();
  });

  it("requires staff access to delete a desafio", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.desafios.delete({ id: "00000000-0000-4000-8000-0000000000f1" })).rejects.toThrow();
  });

  it("requires staff access to manage participantes", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.desafios.participantes.add({ desafioId: "00000000-0000-4000-8000-0000000000f1", alunoId: TEST_USER_ID })).rejects.toThrow();
  });

  it("requires staff access to set progresso", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.desafios.progresso.set({ desafioId: "00000000-0000-4000-8000-0000000000f1", alunoId: TEST_USER_ID, concluido: true })).rejects.toThrow();
  });
});

describe("arke.desafios.meus", () => {
  it("cannot list without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.desafios.meus()).rejects.toThrow();
  });
});

describe("prescricao.competicoes", () => {
  it("requires staff access to the organization to list", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.competicoes.list({ organizationId: TEST_ORG_ID })).rejects.toThrow();
  });

  it("requires staff access to the organization to create", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.competicoes.create({ organizationId: TEST_ORG_ID, titulo: "Competição de setembro", dataInicio: "2026-09-01", dataFim: "2026-09-30" })).rejects.toThrow();
  });

  it("requires staff access to update a competição", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.competicoes.update({ id: "00000000-0000-4000-8000-0000000000f2", titulo: "Novo título", metrica: "Km corridos", dataInicio: "2026-09-01", dataFim: "2026-09-30", paraTodos: true })).rejects.toThrow();
  });

  it("requires staff access to delete a competição", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.competicoes.delete({ id: "00000000-0000-4000-8000-0000000000f2" })).rejects.toThrow();
  });

  it("requires staff access to manage participantes", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.competicoes.participantes.add({ competicaoId: "00000000-0000-4000-8000-0000000000f2", alunoId: TEST_USER_ID })).rejects.toThrow();
  });

  it("requires staff access to set pontuacao", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.competicoes.pontuacao.set({ competicaoId: "00000000-0000-4000-8000-0000000000f2", alunoId: TEST_USER_ID, valor: 42 })).rejects.toThrow();
  });
});

describe("arke.competicoes.meus", () => {
  it("cannot list without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).arke.competicoes.meus()).rejects.toThrow();
  });
});

describe("prescricao.progresso (evolução)", () => {
  it("requires staff access to the aluno's organization to list", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.progresso.list({ alunoId: TEST_USER_ID })).rejects.toThrow();
  });

  it("requires staff access to the aluno's organization to create a measurement", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.progresso.create({ alunoId: TEST_USER_ID, pesoKg: 80 })).rejects.toThrow();
  });

  it("rejects a bem-estar value outside the accepted 1-5 range", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.progresso.create({ alunoId: TEST_USER_ID, bemEstar: 9 })).rejects.toThrow();
  });

  it("requires staff access to delete a measurement", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.progresso.delete({ id: "00000000-0000-0000-0000-0000000000d1" })).rejects.toThrow();
  });
});

describe("notificacoes (inbox in-app)", () => {
  it("cannot list without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).notificacoes.minhas()).rejects.toThrow();
  });

  it("cannot count unread without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).notificacoes.naoLidas()).rejects.toThrow();
  });

  it("cannot mark as read without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).notificacoes.marcarLida({ id: "00000000-0000-4000-8000-0000000000f4" })).rejects.toThrow();
  });
});

describe("prescricao.prontuario", () => {
  it("requires staff access to the aluno's organization to list", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.prontuario.list({ alunoId: TEST_USER_ID })).rejects.toThrow();
  });

  it("requires staff access to save a note", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.prontuario.upsert({ alunoId: TEST_USER_ID, mes: 9, ano: 2026, observacao: "Nota de teste" })).rejects.toThrow();
  });

  it("rejects a mes value outside the accepted 1-12 range", async () => {
    await expect(appRouter.createCaller(createContext()).prescricao.prontuario.upsert({ alunoId: TEST_USER_ID, mes: 13, ano: 2026, observacao: "Nota de teste" })).rejects.toThrow();
  });
});

describe("plataforma (painel de negócio ArkeFit)", () => {
  it("blocks a non-admin caller from the cross-organization dashboard", async () => {
    const nonAdminContext: TrpcContext = { ...createContext(), user: { ...createContext().user, role: "user" } };
    await expect(appRouter.createCaller(nonAdminContext).plataforma.dashboard()).rejects.toThrow();
  });

  it("returns zeroed indicators instead of throwing when Supabase isn't configured", async () => {
    const result = await appRouter.createCaller(createContext()).plataforma.dashboard();
    expect(result).toEqual({ totalOrganizacoes: 0, porStatus: { trial: 0, active: 0, past_due: 0, canceled: 0 }, mrrCents: 0, novasEsteMes: 0, canceladasEsteMes: 0, alunosArkeAtivos: 0 });
  });

  it("blocks a non-admin caller from the cross-organization financeiro", async () => {
    const nonAdminContext: TrpcContext = { ...createContext(), user: { ...createContext().user, role: "user" } };
    await expect(appRouter.createCaller(nonAdminContext).plataforma.financeiro()).rejects.toThrow();
  });

  it("returns empty financeiro instead of throwing when Supabase isn't configured", async () => {
    const result = await appRouter.createCaller(createContext()).plataforma.financeiro();
    expect(result).toEqual({ pagamentos: [], totalRecebidoReais: 0, totalPendenteReais: 0 });
  });

  it("blocks a non-admin caller from the internal agenda", async () => {
    const nonAdminContext: TrpcContext = { ...createContext(), user: { ...createContext().user, role: "user" } };
    await expect(appRouter.createCaller(nonAdminContext).plataforma.agenda.list({})).rejects.toThrow();
  });

  it("returns an empty agenda instead of throwing when Supabase isn't configured", async () => {
    const result = await appRouter.createCaller(createContext()).plataforma.agenda.list({});
    expect(result).toEqual([]);
  });

  it("fails closed on agenda.create without a configured database", async () => {
    await expect(appRouter.createCaller(createContext()).plataforma.agenda.create({ titulo: "Onboarding Academia X", scheduledAt: new Date().toISOString() })).rejects.toThrow();
  });
});

describe("push (Fase 3 — comunicação)", () => {
  it("returns a null public key when VAPID is not configured (never throws)", async () => {
    await expect(appRouter.createCaller(createContext()).push.publicKey()).resolves.toEqual({ publicKey: null });
  });

  it("cannot subscribe without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).push.subscribe({ endpoint: "https://push.example.com/abc", keys: { p256dh: "key", auth: "auth" } })).rejects.toThrow();
  });

  it("cannot unsubscribe without a configured Supabase profile lookup", async () => {
    await expect(appRouter.createCaller(createContext()).push.unsubscribe({ endpoint: "https://push.example.com/abc" })).rejects.toThrow();
  });
});
