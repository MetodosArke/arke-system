import { describe, expect, it } from "vitest";
import { minutosRestantes, percentualConcluido, proximaEtapa, type StatusEtapa } from "./onboardingAcademia";
import { montarLembrete } from "../../supabase/functions/lembrete-onboarding/email";

const status = (concluidas: string[]): StatusEtapa[] =>
  (["dados", "recebimentos", "planos", "equipe", "alunos"] as const).map((etapa) => ({
    etapa,
    concluida: concluidas.includes(etapa),
    detalhe: null,
  }));

describe("checklist do onboarding", () => {
  it("percentual pelo número de etapas concluídas", () => {
    expect(percentualConcluido(status([]))).toBe(0);
    expect(percentualConcluido(status(["dados", "planos"]))).toBe(40);
    expect(percentualConcluido(status(["dados", "recebimentos", "planos", "equipe", "alunos"]))).toBe(100);
  });

  it("próxima etapa segue a ordem do checklist, não a do banco", () => {
    expect(proximaEtapa(status(["dados"]))).toBe("recebimentos");
    expect(proximaEtapa([...status(["dados", "recebimentos"])].reverse())).toBe("planos");
    expect(proximaEtapa(status(["dados", "recebimentos", "planos", "equipe", "alunos"]))).toBeNull();
  });

  it("tempo restante soma só o que falta", () => {
    expect(minutosRestantes(status(["dados", "recebimentos", "planos", "equipe", "alunos"]))).toBe(0);
    expect(minutosRestantes(status(["dados", "recebimentos", "planos", "equipe"]))).toBe(5);
  });
});

describe("e-mail do lembrete", () => {
  it("lista as etapas pendentes com nome de gente", () => {
    const { assunto, texto, html } = montarLembrete("Academia X", "recebimentos, planos", "https://arkefit.com.br/#/admin/onboarding");
    expect(assunto).toContain("faltam 2 etapa(s)");
    expect(texto).toContain("- Conta de recebimentos (Asaas)");
    expect(texto).toContain("- Planos e preços");
    expect(html).toContain("https://arkefit.com.br/#/admin/onboarding");
  });

  it("escapa o nome da academia no HTML", () => {
    expect(montarLembrete("<b>X</b>", null, "https://x").html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
