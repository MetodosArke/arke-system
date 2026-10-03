import { describe, expect, it } from "vitest";
import {
  filtrarProfissionais,
  podeTrocarResponsavel,
  rotuloImplantacao,
  situacaoAcesso,
  telefoneValido,
} from "@/lib/profissionaisAutonomos";
import { emailPainelPronto } from "../../supabase/functions/convidar-profissional-autonomo/email";

describe("situação do acesso do responsável", () => {
  it("sem gestor é sem responsável, mesmo com último acesso de outra linha", () => {
    expect(situacaoAcesso({ sem_gestor: true, ultimo_acesso: null })).toBe("sem_responsavel");
  });
  it("quem nunca entrou está com o convite pendente", () => {
    expect(situacaoAcesso({ sem_gestor: false, ultimo_acesso: null })).toBe("convite_pendente");
  });
  it("quem já entrou usa o painel", () => {
    expect(situacaoAcesso({ sem_gestor: false, ultimo_acesso: "2026-10-03T10:00:00Z" })).toBe("ativo");
  });
  it("troca o responsável só enquanto ele nunca entrou", () => {
    expect(podeTrocarResponsavel({ sem_gestor: true, ultimo_acesso: null })).toBe(true);
    expect(podeTrocarResponsavel({ sem_gestor: false, ultimo_acesso: null })).toBe(true);
    expect(podeTrocarResponsavel({ sem_gestor: false, ultimo_acesso: "2026-10-03T10:00:00Z" })).toBe(false);
  });
});

describe("implantação na lista", () => {
  it("liberado quando a configuração terminou", () => {
    expect(rotuloImplantacao({ onboarding_completed: true, etapa_implantacao: "primeiro_aluno_app" })).toBe("Liberado");
  });
  it("a etapa da vez, ou que ainda não começou", () => {
    expect(rotuloImplantacao({ onboarding_completed: false, etapa_implantacao: null })).toBe("Não começou");
    expect(rotuloImplantacao({ onboarding_completed: false, etapa_implantacao: "dados" })).not.toBe("dados");
  });
});

describe("busca", () => {
  const lista = [
    { nome: "Arke_Jean", gestor_nome: null, email: null },
    { nome: "Studio Vida", gestor_nome: "Ana Júlia Souza", email: "ana@exemplo.com" },
  ];
  it("acha pelo painel, pelo responsável sem acento e pelo e-mail", () => {
    expect(filtrarProfissionais(lista, "jean").map((p) => p.nome)).toEqual(["Arke_Jean"]);
    expect(filtrarProfissionais(lista, "JULIA").map((p) => p.nome)).toEqual(["Studio Vida"]);
    expect(filtrarProfissionais(lista, "@exemplo").map((p) => p.nome)).toEqual(["Studio Vida"]);
  });
  it("busca vazia devolve todos", () => {
    expect(filtrarProfissionais(lista, "  ")).toHaveLength(2);
  });
});

describe("telefone", () => {
  it("vazio passa, e com DDD passa", () => {
    expect(telefoneValido("")).toBe(true);
    expect(telefoneValido("(11) 98888-7777")).toBe(true);
    expect(telefoneValido("+55 11 98888-7777")).toBe(true);
  });
  it("sem DDD não passa", () => {
    expect(telefoneValido("98888-7777")).toBe(false);
  });
});

describe("e-mail de painel pronto para quem já tinha conta", () => {
  const base = { nome: "Jean Ramos", painel: "Jean <Personal>", especialidade: "professor" as const, link: "https://app.arkefit.com.br/#/auth/login" };
  it("quem já entra recebe o link de entrar, sem convite de senha", () => {
    const e = emailPainelPronto({ ...base, criarSenha: false });
    expect(e.assunto).toBe("Seu painel de Personal Trainer no ArkeFit está pronto");
    expect(e.texto).toContain("Olá, Jean.");
    expect(e.texto).toContain("Entrar no painel: https://app.arkefit.com.br/#/auth/login");
    expect(e.texto).toContain("mesmo e-mail e a senha que você já usa");
  });
  it("quem nunca criou a senha recebe o botão de criar", () => {
    const e = emailPainelPronto({ ...base, especialidade: "nutricionista", criarSenha: true });
    expect(e.assunto).toContain("Nutricionista");
    expect(e.texto).toContain("Criar minha senha:");
  });
  it("o nome do painel não vira HTML", () => {
    const e = emailPainelPronto({ ...base, criarSenha: false });
    expect(e.html).toContain("Jean &lt;Personal&gt;");
    expect(e.html).not.toContain("<Personal>");
  });
});
