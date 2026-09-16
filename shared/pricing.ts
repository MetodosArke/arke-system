// Regras comerciais do Sistema Arke — fonte única para cliente e servidor
// (antes duplicado em SaasPage.tsx, ClientProfilePage.tsx, appCatalog.ts e
// server/db.ts, cada um com seus próprios valores hardcoded).

export const ORG_PLAN_KEYS = ["starter", "growth", "scale"] as const;
export type OrgPlan = (typeof ORG_PLAN_KEYS)[number];

export const PROFISSIONAL_PLAN_KEYS = ["essencial", "performance", "ilimitado"] as const;
export type ProfissionalPlan = (typeof PROFISSIONAL_PLAN_KEYS)[number];

export const SAAS_PLAN_KEYS = [...ORG_PLAN_KEYS, ...PROFISSIONAL_PLAN_KEYS] as const;
export type SaasPlan = OrgPlan | ProfissionalPlan;

export const ORG_PLAN_LABELS: Record<OrgPlan, string> = { starter: "Starter", growth: "Growth", scale: "Scale" };
export const PROFISSIONAL_PLAN_LABELS: Record<ProfissionalPlan, string> = { essencial: "Essencial", performance: "Performance", ilimitado: "Ilimitado" };

// Academia/Studio (mensal, em centavos).
export const ORG_PLAN_AMOUNTS_CENTS: Record<OrgPlan, number> = { starter: 29900, growth: 69900, scale: 149000 };
// Profissional (personal/nutricionista independente, mensal, em centavos).
export const PROFISSIONAL_PLAN_AMOUNTS_CENTS: Record<ProfissionalPlan, number> = { essencial: 7900, performance: 14900, ilimitado: 24900 };

export const PLAN_LIMITS: Record<SaasPlan, { maxUnits: number; maxUsers: number }> = {
  starter: { maxUnits: 1, maxUsers: 12 },
  growth: { maxUnits: 3, maxUsers: 32 },
  scale: { maxUnits: 10, maxUsers: 100 },
  essencial: { maxUnits: 1, maxUsers: 3 },
  performance: { maxUnits: 1, maxUsers: 8 },
  ilimitado: { maxUnits: 1, maxUsers: 999 },
};

export const PLAN_AMOUNTS_CENTS: Record<SaasPlan, number> = { ...ORG_PLAN_AMOUNTS_CENTS, ...PROFISSIONAL_PLAN_AMOUNTS_CENTS };

export const formatBRL = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const orgPlanOptions = ORG_PLAN_KEYS.map((key) => ({ value: key, label: `${ORG_PLAN_LABELS[key]} — ${formatBRL(ORG_PLAN_AMOUNTS_CENTS[key])}/mês` }));
export const profissionalPlanOptions = PROFISSIONAL_PLAN_KEYS.map((key) => ({ value: key, label: `${PROFISSIONAL_PLAN_LABELS[key]} — ${formatBRL(PROFISSIONAL_PLAN_AMOUNTS_CENTS[key])}/mês` }));

// Taxa de setup: cobrança única no fechamento do onboarding da organização.
export const SETUP_FEE_CENTS = 149000;

// Módulo Arke (conteúdo do método, opt-in — CLAUDE.md §3/§8): pacote fixo
// que a academia paga para habilitar o módulo, com o mesmo tier do seu
// plano de base, + custo variável por aluno com o método ativo.
export const ARKE_MODULE_PACKAGE_AMOUNTS_CENTS: Record<OrgPlan, number> = { starter: 9900, growth: 24900, scale: 49900 };
export const ARKE_ALUNO_WHOLESALE_CENTS = 5990;
