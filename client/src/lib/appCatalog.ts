export type ModuleKey = "academia" | "studio" | "profissional" | "aluno" | "administrador";

export type UserProfile = {
  name: string;
  email: string;
  username?: string;
  role: string;
  initials: string;
  module: ModuleKey;
  workspace: string;
  logoUrl?: string;
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  academia: "Academia",
  studio: "Studio",
  profissional: "Profissional",
  aluno: "Aluno",
  administrador: "Administrador",
};

export const MODULE_VIEWS: Record<ModuleKey, "overview" | "academias" | "profissionais" | "alunos" | "meus-alunos" | "meu-treino"> = {
  academia: "academias",
  studio: "academias",
  profissional: "meus-alunos",
  aluno: "meu-treino",
  administrador: "overview",
};

export const MODULE_PERMISSIONS: Record<ModuleKey, string[]> = {
  academia: ["overview", "academias", "alunos", "gestao", "crm", "desafios", "agenda", "financeiro", "integracoes"],
  studio: ["overview", "studios", "academias", "alunos", "gestao", "turmas", "crm", "desafios", "agenda", "financeiro", "integracoes"],
  profissional: ["overview", "meus-alunos", "minha-fila", "crm", "desafios", "agenda"],
  aluno: ["overview", "meu-treino", "minhas-turmas", "agenda"],
  administrador: ["overview", "academias", "studios", "profissionais", "alunos", "gestao", "turmas", "crm", "desafios", "agenda", "financeiro", "integracoes", "saas", "admin", "acervo", "configuracoes"],
};

export const SAAS_PLANS = ["Starter", "Growth", "Scale", "Essencial", "Performance", "Ilimitado"] as const;
export const MODULE_KEYS: ModuleKey[] = ["academia", "studio", "profissional", "aluno", "administrador"];
