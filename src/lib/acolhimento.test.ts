import { describe, expect, it, vi } from "vitest";
import { enviarAnamnese, type GravadorAnamnese } from "./acolhimento";

type Linha = { aluno_id: string; dores_lesoes: string };
const linha: Linha = { aluno_id: "a1", dores_lesoes: "joelho" };

function gravador(inclusao: { code?: string; message: string } | null, alteradas: unknown[] | null = []) {
  const g: GravadorAnamnese<Linha> = {
    inserir: vi.fn(async () => ({ error: inclusao })),
    completarSeAberta: vi.fn(async () => ({ data: alteradas, error: null })),
  };
  return g;
}

describe("enviarAnamnese", () => {
  it("aluno sem anamnese: inclui", async () => {
    const g = gravador(null);
    await expect(enviarAnamnese(linha, g)).resolves.toBe("gravada");
    expect(g.completarSeAberta).not.toHaveBeenCalled();
  });

  it("anamnese aberta (sem conclusão): completa", async () => {
    const g = gravador({ code: "23505", message: "duplicate key" }, [{ id: "x" }]);
    await expect(enviarAnamnese(linha, g)).resolves.toBe("completada");
  });

  it("anamnese concluída: não sobrescreve e avisa que já existia", async () => {
    const g = gravador({ code: "23505", message: "duplicate key" }, []);
    await expect(enviarAnamnese(linha, g)).resolves.toBe("ja_existia");
  });

  it("outro erro na inclusão é erro, e não tenta alterar", async () => {
    const g = gravador({ code: "42501", message: "permission denied" });
    await expect(enviarAnamnese(linha, g)).rejects.toMatchObject({ code: "42501" });
    expect(g.completarSeAberta).not.toHaveBeenCalled();
  });

  it("erro ao completar é erro", async () => {
    const g = gravador({ code: "23505", message: "duplicate key" });
    g.completarSeAberta = async () => ({ data: null, error: { message: "rede" } });
    await expect(enviarAnamnese(linha, g)).rejects.toMatchObject({ message: "rede" });
  });
});
