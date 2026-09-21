import { describe, it, expect, vi } from "vitest";
import {
  verificarSenhaVazada,
  contarOcorrencias,
  senhaDeveSerRecusada,
  mensagemSenhaVazada,
  OCORRENCIAS_PARA_RECUSAR,
} from "./senhaVazada";

// SHA-1 de "password" = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
// Prefixo enviado: 5BAA6 · sufixo comparado localmente: 1E4C9B93F3F0682250B6CF8331B7EE68FD8
const SUFIXO_DE_PASSWORD = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

function faixaFalsa(linhas: string[]): (prefixo: string) => Promise<string> {
  return async () => linhas.join("\r\n");
}

describe("contarOcorrencias", () => {
  it("acha o sufixo e devolve a contagem", () => {
    const corpo = ["0018A45C4D1DEF81644B54AB7F969CA6F4E:5", `${SUFIXO_DE_PASSWORD}:9659365`].join("\r\n");
    expect(contarOcorrencias(corpo, SUFIXO_DE_PASSWORD)).toBe(9659365);
  });

  it("devolve zero quando o sufixo não está na faixa", () => {
    expect(contarOcorrencias("0018A45C4D1DEF81644B54AB7F969CA6F4E:5", SUFIXO_DE_PASSWORD)).toBe(0);
  });

  it("ignora os registros de preenchimento, que vêm com contagem zero", () => {
    // O cabeçalho Add-Padding faz a API devolver sufixos falsos para o
    // tamanho da resposta não entregar a faixa consultada. Tratá-los como
    // reais recusaria senha limpa por causa do próprio mecanismo de
    // privacidade.
    const corpo = [`${SUFIXO_DE_PASSWORD}:0`, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0"].join("\r\n");
    expect(contarOcorrencias(corpo, SUFIXO_DE_PASSWORD)).toBe(0);
  });

  it("não se perde com maiúscula/minúscula nem com espaços", () => {
    const corpo = `  ${SUFIXO_DE_PASSWORD.toLowerCase()}:42  `;
    expect(contarOcorrencias(corpo, SUFIXO_DE_PASSWORD)).toBe(42);
  });

  it("devolve zero em corpo vazio ou malformado", () => {
    expect(contarOcorrencias("", SUFIXO_DE_PASSWORD)).toBe(0);
    expect(contarOcorrencias("lixo sem dois pontos", SUFIXO_DE_PASSWORD)).toBe(0);
  });
});

describe("verificarSenhaVazada", () => {
  it("reprova senha conhecida e informa quantas vezes apareceu", async () => {
    const r = await verificarSenhaVazada("password", faixaFalsa([`${SUFIXO_DE_PASSWORD}:9659365`]));
    expect(r.verificou).toBe(true);
    expect(r.vazada).toBe(true);
    expect(r.ocorrencias).toBe(9659365);
  });

  it("aprova senha que não está no corpus", async () => {
    const r = await verificarSenhaVazada("password", faixaFalsa(["0018A45C4D1DEF81644B54AB7F969CA6F4E:5"]));
    expect(r.verificou).toBe(true);
    expect(r.vazada).toBe(false);
  });

  it("envia só os 5 primeiros caracteres do hash — a senha não sai do navegador", async () => {
    const espiao = vi.fn(async (_prefixo: string) => "");
    await verificarSenhaVazada("password", espiao);

    expect(espiao).toHaveBeenCalledWith("5BAA6");
    // O que foi enviado não contém a senha nem o hash completo.
    const enviado = espiao.mock.calls[0][0];
    expect(enviado).toHaveLength(5);
    expect(enviado).not.toContain("password");
  });

  it("falha aberta quando o HIBP não responde", async () => {
    const r = await verificarSenhaVazada("password", async () => {
      throw new Error("rede fora");
    });

    // Indisponibilidade de terceiro não pode virar cadastro bloqueado.
    expect(r.verificou).toBe(false);
    expect(r.vazada).toBe(false);
    expect(senhaDeveSerRecusada(r)).toBe(false);
  });

  it("não consulta nada com senha vazia", async () => {
    const espiao = vi.fn(async () => "");
    const r = await verificarSenhaVazada("", espiao);
    expect(espiao).not.toHaveBeenCalled();
    expect(r.verificou).toBe(false);
  });
});

describe("senhaDeveSerRecusada", () => {
  it("só recusa quando a consulta aconteceu de verdade", () => {
    expect(senhaDeveSerRecusada({ vazada: true, ocorrencias: 10, verificou: true })).toBe(true);
    // Este é o caso que importa: sem consulta, não há veredito.
    expect(senhaDeveSerRecusada({ vazada: true, ocorrencias: 10, verificou: false })).toBe(false);
    expect(senhaDeveSerRecusada({ vazada: false, ocorrencias: 0, verificou: true })).toBe(false);
  });

  it("uma aparição já basta, como no recurso pago do Supabase", () => {
    expect(OCORRENCIAS_PARA_RECUSAR).toBe(1);
  });
});

describe("mensagemSenhaVazada", () => {
  it("não diz que a senha do usuário vazou daqui", () => {
    const msg = mensagemSenhaVazada(1234);
    // Ela não vazou do ARKE, e sugerir isso assusta sem informar.
    expect(msg).not.toMatch(/sua senha vazou|fomos invadidos|nosso sistema/i);
    expect(msg).toContain("outros sites");
  });

  it("concorda em número e formata o milhar em pt-BR", () => {
    expect(mensagemSenhaVazada(1)).toContain("1 vez");
    expect(mensagemSenhaVazada(9659365)).toContain("9.659.365 vezes");
  });
});
