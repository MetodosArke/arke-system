import { describe, it, expect } from "vitest";
import {
  CHAVE_API_LITENET3,
  direcaoDaPassagem,
  interpretarMensagem,
  lerDescoberta,
  linhaDoDisplay,
  mensagemDescoberta,
  mensagemLiberar,
  mensagemServidor,
  mensagensNegar,
} from "../src/conectores/toletus/litenet3/protocolo";

/**
 * As mensagens da LiteNet3 conferidas contra o pacote oficial da Toletus
 * (LiteNet3-IntegrationPackage) e os exemplos da API do Toletus Hub.
 */

describe("LiteNet3: mensagens que o Gateway manda", () => {
  it("descoberta e endereço do servidor, como LiteNetUtil.Search e SetServer", () => {
    expect(JSON.parse(mensagemDescoberta())).toEqual({ fetch: "discovery", data: null });
    expect(JSON.parse(mensagemServidor("00000002", "ws://192.168.25.10:7880"))).toEqual({
      update: "server",
      data: { serial: "00000002", uri: "ws://192.168.25.10:7880" },
    });
  });

  it("liberação: action litenet3 com release In/Out/Both e as duas linhas do display", () => {
    expect(JSON.parse(mensagemLiberar("entrada", "Bem-vindo!"))).toEqual({
      action: "litenet3",
      data: { release: "In", topRow: "Bem-vindo!", bottomRow: "" },
    });
    expect(JSON.parse(mensagemLiberar("saida", "x")).data.release).toBe("Out");
    expect(JSON.parse(mensagemLiberar("ambos", "x")).data.release).toBe("Both");
  });

  it("display sem acento e com no máximo 16 caracteres", () => {
    expect(linhaDoDisplay("Recepção — já")).toBe("Recepcao ? ja");
    expect(linhaDoDisplay("Uma frase com mais de dezesseis")).toHaveLength(16);
  });

  it("negar é texto no display e o toque de erro do exemplo oficial", () => {
    const [display, toque] = mensagensNegar("Fale c/ recepcao").map((m) => JSON.parse(m));
    expect(display).toMatchObject({ action: "display", data: { topRow: "Fale c/ recepcao", time: 3000 } });
    expect(toque).toEqual({ action: "buzzer", data: { play: "err:d=4,o=4,b=180:f#,32p,f#" } });
  });

  it("a chave do firmware é a do pacote oficial", () => {
    expect(CHAVE_API_LITENET3).toBe("12345-abcde-67890-fghij");
  });
});

describe("LiteNet3: mensagens que a placa manda", () => {
  it("resposta da descoberta, com o serial e o servidor atual", () => {
    const bruto = JSON.stringify({
      fetch: "discovery",
      data: { serial: "00000002", id: 2, alias: "Edson", serverUri: "ws://10.0.0.5:4000", ip: "192.168.25.2", connected: false, firmware: "V1.0.1.2", hardware: "V1.0.0" },
    });
    expect(lerDescoberta(bruto)).toEqual({ serial: "00000002", id: 2, firmware: "V1.0.1.2", servidor: "ws://10.0.0.5:4000" });
    expect(lerDescoberta(JSON.stringify({ fetch: "flow", data: {} }))).toBeNull();
    expect(lerDescoberta("lixo")).toBeNull();
  });

  it("cartão, código de barras e teclado; o cartão sem zeros à esquerda, o teclado com eles", () => {
    expect(interpretarMensagem(JSON.stringify({ notification: "rfid", data: { serial: "2", code: "0003954862189" } })).evento).toEqual({
      tipo: "identificacao",
      origem: "rfid",
      valor: "3954862189",
    });
    expect(interpretarMensagem(JSON.stringify({ notification: "Barcode", data: { code: "789" } })).evento).toMatchObject({
      origem: "codigo_barras",
      valor: "789",
    });
    expect(interpretarMensagem(JSON.stringify({ notification: "keypad", data: { Code: "01234567890" } })).evento).toMatchObject({
      origem: "teclado",
      valor: "01234567890",
    });
  });

  it("passagem: com um contador só, é aquele sentido; com os dois, o que subiu", () => {
    expect(direcaoDaPassagem({ in: 1 }, null).direcao).toBe("entrada");
    expect(direcaoDaPassagem({ out: 3 }, null).direcao).toBe("saida");
    expect(direcaoDaPassagem({ in: 104, out: 29 }, { entrada: 103, saida: 29 }).direcao).toBe("entrada");
    expect(direcaoDaPassagem({ in: 104, out: 30 }, { entrada: 104, saida: 29 }).direcao).toBe("saida");
    // Primeira passagem com os dois contadores: não há com o que comparar.
    expect(direcaoDaPassagem({ in: 104, out: 29 }, null).direcao).toBe("indefinida");

    const primeira = interpretarMensagem(JSON.stringify({ notification: "passage", data: { in: 10, out: 4 } }));
    const segunda = interpretarMensagem(JSON.stringify({ notification: "passage", data: { in: 11, out: 4 } }), primeira.contadores);
    expect(segunda.evento).toEqual({ tipo: "passagem", direcao: "entrada" });
  });

  it("tempo esgotado, ping, erro e a imagem da digital", () => {
    expect(interpretarMensagem(JSON.stringify({ notification: "timeout", data: { release: "In", time: 10000 } })).evento).toEqual({
      tipo: "tempo_esgotado",
    });
    expect(interpretarMensagem(JSON.stringify({ notification: "ping", data: { systemState: "ok" } })).evento).toEqual({ tipo: "ping" });
    expect(interpretarMensagem(JSON.stringify({ notification: "error", data: { device: "sm25" } })).evento).toEqual({
      tipo: "erro",
      dispositivo: "sm25",
    });
    // A imagem não aparece no evento: o conteúdo é descartado na leitura.
    const digital = interpretarMensagem(JSON.stringify({ notification: "biometrics", data: { package: "AAECAw==", init: true } }));
    expect(digital.evento).toEqual({ tipo: "biometria" });
  });

  it("fábrica (firmware) e resultado de ordem, no topo ou dentro de data", () => {
    expect(
      interpretarMensagem(JSON.stringify({ fetch: "factory", data: { serial: "00000002", factory: false, firmware: "V1.0.1.2", hardware: "V1.0.0" } })).evento
    ).toEqual({ tipo: "fabrica", serial: "00000002", firmware: "V1.0.1.2", hardware: "V1.0.0" });
    expect(interpretarMensagem(JSON.stringify({ action: "litenet3", result: "ok" })).evento).toEqual({
      tipo: "resposta",
      chave: "action:litenet3",
      resultado: "ok",
      motivo: null,
    });
    expect(interpretarMensagem(JSON.stringify({ action: "buzzer", data: { result: "error", reason: "unauthorized" } })).evento).toMatchObject({
      resultado: "error",
      motivo: "unauthorized",
    });
  });

  it("mensagem que não é JSON ou não tem tipo é ignorada", () => {
    expect(interpretarMensagem("{").evento).toEqual({ tipo: "ignorado" });
    expect(interpretarMensagem(JSON.stringify({ outra: 1 })).evento).toEqual({ tipo: "ignorado" });
  });
});
