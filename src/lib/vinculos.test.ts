import { describe, it, expect } from "vitest";
import { escolherVinculo } from "./vinculos";

const v = (role: string, created_at: string) => ({ role, created_at });

describe("escolherVinculo", () => {
  it("devolve null sem vínculos", () => {
    expect(escolherVinculo([])).toBeNull();
  });

  it("prefere o vínculo de equipe ao de aluno", () => {
    // O caso real: a pessoa é gestora de uma academia e aluna de outra.
    // Entrar como aluna a trancaria fora do painel que ela administra.
    const escolhido = escolherVinculo([
      v("aluno", "2025-01-01T00:00:00Z"),
      v("gestor", "2025-06-01T00:00:00Z"),
    ]);
    expect(escolhido?.role).toBe("gestor");
  });

  it("respeita a hierarquia gestor > professor > nutricionista", () => {
    const escolhido = escolherVinculo([
      v("nutricionista", "2025-01-01T00:00:00Z"),
      v("professor", "2025-01-02T00:00:00Z"),
      v("gestor", "2025-01-03T00:00:00Z"),
    ]);
    expect(escolhido?.role).toBe("gestor");
  });

  it("desempata pelo vínculo mais antigo dentro do mesmo papel", () => {
    const escolhido = escolherVinculo([
      v("professor", "2025-05-01T00:00:00Z"),
      v("professor", "2025-02-01T00:00:00Z"),
    ]);
    expect(escolhido?.created_at).toBe("2025-02-01T00:00:00Z");
  });

  it("não reordena o array recebido", () => {
    const lista = [v("aluno", "2025-01-01T00:00:00Z"), v("gestor", "2025-01-02T00:00:00Z")];
    escolherVinculo(lista);
    expect(lista[0].role).toBe("aluno");
  });

  it("põe papel desconhecido por último em vez de derrubar a escolha", () => {
    const escolhido = escolherVinculo([
      v("papel_novo", "2024-01-01T00:00:00Z"),
      v("aluno", "2025-01-01T00:00:00Z"),
    ]);
    expect(escolhido?.role).toBe("aluno");
  });

  it("a unidade escolhida no seletor vence a hierarquia", () => {
    const vinculos = [
      { role: "gestor", created_at: "2025-01-01T00:00:00Z", organization_id: "org-a" },
      { role: "professor", created_at: "2025-02-01T00:00:00Z", organization_id: "org-b" },
    ];
    expect(escolherVinculo(vinculos, "org-b")?.organization_id).toBe("org-b");
  });

  it("preferência de unidade sem vínculo ativo é ignorada", () => {
    const vinculos = [{ role: "gestor", created_at: "2025-01-01T00:00:00Z", organization_id: "org-a" }];
    expect(escolherVinculo(vinculos, "org-removida")?.organization_id).toBe("org-a");
  });
});
