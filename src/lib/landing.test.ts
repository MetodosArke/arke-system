import { describe, it, expect } from "vitest";
import { destinoNoApp, mostrarPaginaDeVendas } from "./landing";

const visitante = { temSessao: false, appInstalado: false };

describe("quem vê a página de vendas", () => {
  it("visitante na raiz do endereço de vendas", () => {
    expect(mostrarPaginaDeVendas({ host: "www.arkefit.com.br", hash: "", ...visitante })).toBe(true);
    expect(mostrarPaginaDeVendas({ host: "arkefit.com.br", hash: "#/", ...visitante })).toBe(true);
  });

  it("quem já usa o ARKE segue para o app", () => {
    expect(mostrarPaginaDeVendas({ host: "www.arkefit.com.br", hash: "", temSessao: true, appInstalado: false })).toBe(false);
    // O app instalado na tela de início começa em "/".
    expect(mostrarPaginaDeVendas({ host: "www.arkefit.com.br", hash: "", temSessao: false, appInstalado: true })).toBe(false);
  });

  it("no endereço do app e fora da raiz, nunca", () => {
    expect(mostrarPaginaDeVendas({ host: "app.arkefit.com.br", hash: "", ...visitante })).toBe(false);
    expect(mostrarPaginaDeVendas({ host: "www.arkefit.com.br", hash: "#/auth/login", ...visitante })).toBe(false);
  });

  it("pode ser forçada para conferir fora de produção", () => {
    expect(mostrarPaginaDeVendas({ host: "localhost", hash: "", ...visitante, forcar: true })).toBe(true);
  });
});

describe("mudança do app para o endereço próprio", () => {
  const url = (hash: string, host = "www.arkefit.com.br", search = "") => ({ host, hash, search });

  it("sem o endereço do app configurado, ninguém é mandado para lugar nenhum", () => {
    expect(destinoNoApp(url("#/p/academia/primeiro-acesso"), undefined)).toBeNull();
  });

  it("rotas do app vão para o endereço do app com o caminho inteiro", () => {
    expect(destinoNoApp(url("#/p/academia/primeiro-acesso"), "app.arkefit.com.br")).toBe("https://app.arkefit.com.br/#/p/academia/primeiro-acesso");
    // Link de convite: os tokens precisam chegar junto.
    expect(destinoNoApp(url("#/auth/definir-senha?access_token=abc&type=invite"), "app.arkefit.com.br")).toBe(
      "https://app.arkefit.com.br/#/auth/definir-senha?access_token=abc&type=invite",
    );
  });

  it("a raiz e os documentos legais ficam no endereço de vendas", () => {
    expect(destinoNoApp(url(""), "app.arkefit.com.br")).toBeNull();
    expect(destinoNoApp(url("#/privacidade"), "app.arkefit.com.br")).toBeNull();
  });

  it("no próprio endereço do app, não redireciona", () => {
    expect(destinoNoApp(url("#/admin", "app.arkefit.com.br"), "app.arkefit.com.br")).toBeNull();
  });
});
