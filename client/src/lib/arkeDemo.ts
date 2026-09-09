export type ModuleKey = "academia" | "studio" | "profissional" | "aluno" | "administrador";

export type DemoUser = {
  name: string;
  email: string;
  username?: string;
  passwordHash?: string;
  role: string;
  initials: string;
  module: ModuleKey;
  workspace: string;
  logoUrl?: string;
};

export const DEMO_PASSWORD = "12345678";

export const MODULE_LABELS: Record<ModuleKey, string> = {
  academia: "Academia",
  studio: "Studio",
  profissional: "Profissional",
  aluno: "Aluno",
  administrador: "Administrador",
};

export const MODULE_VIEWS: Record<ModuleKey, "overview" | "academias" | "profissionais" | "alunos"> = {
  academia: "academias",
  studio: "academias",
  profissional: "profissionais",
  aluno: "alunos",
  administrador: "overview",
};

export const MODULE_PERMISSIONS: Record<ModuleKey, string[]> = {
  academia: ["overview", "academias", "alunos", "agenda", "financeiro", "integracoes"],
  studio: ["overview", "academias", "alunos", "agenda", "financeiro", "integracoes"],
  profissional: ["overview", "profissionais", "agenda"],
  aluno: ["overview", "alunos", "agenda"],
  administrador: ["overview", "academias", "profissionais", "alunos", "agenda", "financeiro", "integracoes", "saas", "admin", "configuracoes"],
};

export const DEMO_CLIENTS = [
  { name: "Vértice Studio", module: "academia" as ModuleKey, username: "academia", logoUrl: "/arke-logo.png", status: "Ativo" },
  { name: "Studio Movimento", module: "studio" as ModuleKey, username: "studio", logoUrl: "/arke-logo.png", status: "Ativo" },
  { name: "Camila Rocha • Consultório", module: "profissional" as ModuleKey, username: "personal", logoUrl: "/arke-logo.png", status: "Ativo" },
] as const;

export const DEMO_USERS: DemoUser[] = [
  { name: "André Alves", email: "andre.alvesman@gmail.com", passwordHash: "dd95019ad2b55696d8bf1c7305d12cbd52d7b0a8ff7e2028836bc0330e2bb7ee", role: "Super Admin", initials: "AA", module: "administrador", workspace: "Rede Arke Demo" },
  { name: "Método Sarke", email: "comercial@metodosarke.com.br", passwordHash: "738ed8ede20d0a74b7f5f43eca81755d3b07d17118f5743c31f1238434bc1a61", role: "Super Admin", initials: "MS", module: "administrador", workspace: "Rede Arke Demo" },
];

export const DEMO_MODULE_USERS: DemoUser[] = [
  { name: "Vértice Academia", email: "academia@arke.demo", username: "academia", role: "Gestor de Academia", initials: "AC", module: "academia", workspace: "Vértice Studio", logoUrl: DEMO_CLIENTS[0].logoUrl },
  { name: "Studio Movimento", email: "studio@arke.demo", username: "studio", role: "Gestor de Studio", initials: "ST", module: "studio", workspace: "Studio Movimento", logoUrl: DEMO_CLIENTS[1].logoUrl },
  { name: "Camila Rocha", email: "camila@arke.demo", username: "personal", role: "Personal trainer", initials: "CR", module: "profissional", workspace: "Camila Rocha • Consultório", logoUrl: DEMO_CLIENTS[2].logoUrl },
  { name: "Rafael Mendes", email: "rafael@arke.demo", username: "nutricionista", role: "Nutricionista", initials: "RM", module: "profissional", workspace: "Rafael Mendes • Consultório", logoUrl: DEMO_CLIENTS[2].logoUrl },
  { name: "Marina Costa", email: "marina@arke.demo", username: "aluno", role: "Aluno", initials: "MC", module: "aluno", workspace: "Marina Costa" },
  { name: "Administrador Arke", email: "admin@arke.demo", username: "administrador", role: "Administrador", initials: "AD", module: "administrador", workspace: "Rede Arke Demo", logoUrl: "/arke-logo.png" },
];

export const ALL_DEMO_USERS = [...DEMO_USERS, ...DEMO_MODULE_USERS];

export const DEMO_MODULE_CLIENTS = {
  academias: ["Vértice Studio", "Box Norte 360"],
  profissionais: ["Camila Rocha", "Rafael Mendes"],
  alunos: ["Marina Costa", "Lucas Ferreira"],
} as const;

export const DEMO_TENANTS = [
  { name: "Rede Arke Demo", plan: "Scale", status: "Ativa" },
  { name: "Vértice Studio", plan: "Growth", status: "Ativa" },
  { name: "Box Norte 360", plan: "Scale", status: "Ativa" },
] as const;

export const SAAS_PLANS = ["Starter", "Growth", "Scale"] as const;

export async function getDemoUser(email: string, password: string): Promise<DemoUser | undefined> {
  const user = DEMO_USERS.find((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase());
  return user && await passwordMatches(user, password) ? user : undefined;
}

export async function getModuleDemoUser(module: ModuleKey, identifier: string, password: string): Promise<DemoUser | undefined> {
  const normalized = identifier.trim().toLowerCase();
  let dynamicUser: DemoUser | undefined;
  if (typeof localStorage !== "undefined") {
    try {
      const clients = JSON.parse(localStorage.getItem("arke-admin-clients") || "[]") as Array<{ name: string; module: ModuleKey; username: string; logoUrl: string }>;
      const managedUsers = JSON.parse(localStorage.getItem("arke-managed-users") || "[]") as Array<{ name: string; email: string; module: ModuleKey; username: string; role: string; logoUrl?: string }>;
      const client = clients.find((candidate) => candidate.module === module && candidate.username === normalized);
      const managedUser = managedUsers.find((candidate) => candidate.module === module && candidate.username === normalized);
      if (managedUser) dynamicUser = { name: managedUser.name, email: managedUser.email, username: managedUser.username, role: managedUser.role, initials: managedUser.name.slice(0, 2).toUpperCase(), module, workspace: managedUser.name, logoUrl: managedUser.logoUrl || "/arke-logo.png" };
      else if (client) dynamicUser = { name: client.name, email: `${client.username}@arke.demo`, username: client.username, role: `Gestor de ${MODULE_LABELS[module]}`, initials: client.name.slice(0, 2).toUpperCase(), module, workspace: client.name, logoUrl: client.logoUrl };
    } catch { dynamicUser = undefined; }
  }
  const user = dynamicUser ?? (module === "administrador" ? ALL_DEMO_USERS.find((candidate) => candidate.module === module && (candidate.username === normalized || candidate.email.toLowerCase() === normalized)) : DEMO_MODULE_USERS.find((candidate) => candidate.module === module && candidate.username === normalized));
  return user && await passwordMatches(user, password) ? user : undefined;
}

async function passwordMatches(user: DemoUser, password: string) {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(`arke-demo-password:${user.email}`) : null;
  if (stored) return password === stored;
  if (!user.passwordHash) return password === DEMO_PASSWORD;
  const data = new TextEncoder().encode(`arke-demo-v1:${user.email.toLowerCase()}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") === user.passwordHash;
}

export function hasModuleDemoAccounts() {
  return MODULE_KEYS.every((module) => DEMO_MODULE_USERS.some((user) => user.module === module));
}

export const MODULE_KEYS: ModuleKey[] = ["academia", "studio", "profissional", "aluno", "administrador"];

export function hasTwoDemoClientsPerModule() {
  return Object.values(DEMO_MODULE_CLIENTS).every((clients) => clients.length === 2);
}

export function hasValidSaaSDemoCatalog() {
  return DEMO_TENANTS.length >= 3 && SAAS_PLANS.length === 3 && DEMO_TENANTS.every((tenant) => tenant.status === "Ativa");
}
