import { describe, it, expect, vi, beforeEach } from "vitest";
import { importarComRecarga } from "./carregamentoPreguicoso";

beforeEach(() => sessionStorage.clear());

describe("importarComRecarga", () => {
  it("devolve o módulo quando o arquivo existe", async () => {
    const recarregar = vi.fn();
    const modulo = await importarComRecarga(async () => ({ default: "Pagina" }), recarregar);
    expect(modulo).toEqual({ default: "Pagina" });
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("recarrega uma vez quando o arquivo sumiu depois de um deploy", async () => {
    const recarregar = vi.fn();
    void importarComRecarga(async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    }, recarregar);
    await new Promise((r) => setTimeout(r, 0));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("não entra em laço: se acabou de recarregar e ainda falha, o erro segue adiante", async () => {
    // Simula a segunda tentativa, logo depois da recarga.
    sessionStorage.setItem("arke:recarga-por-versao-nova", String(Date.now()));
    const recarregar = vi.fn();
    await expect(
      importarComRecarga(async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      }, recarregar)
    ).rejects.toThrow(/dynamically imported/);
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("recarga antiga não trava a próxima: passados 30s, volta a tentar", async () => {
    sessionStorage.setItem("arke:recarga-por-versao-nova", String(Date.now() - 60_000));
    const recarregar = vi.fn();
    void importarComRecarga(async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    }, recarregar);
    await new Promise((r) => setTimeout(r, 0));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});
