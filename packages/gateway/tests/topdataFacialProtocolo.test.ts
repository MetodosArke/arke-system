import { describe, it, expect } from "vitest";
import {
  ENROLLID_DESCONHECIDO,
  apagarConcluido,
  ehPedidoDeAcesso,
  horaDoLeitor,
  interpretarMensagem,
  lerHoraDoLeitor,
  ordemApagar,
  ordemModo,
  ordemUsuario,
  respostaAcesso,
  respostaRecebido,
  respostaReg,
} from "../src/conectores/topdataFacial/protocolo";

/**
 * As mensagens do leitor facial da Topdata conferidas contra a página
 * "Comandos do Leitor Facial" do portal de integradores (02/10/2026).
 */

const AGORA = new Date("2026-10-02T14:40:21.000Z"); // 11:40:21 em Brasília

describe("leitor facial Topdata: o que o leitor manda", () => {
  it("reg, com o número de série e o modelo", () => {
    const bruto = JSON.stringify({
      cmd: "reg",
      sn: "1234567890",
      devinfo: { modelname: "AiFace", useduser: 204, usedface: 3, firmware: "ai518_fp26v_v1.27", mac: "00-00-00-00-00-00" },
    });
    expect(interpretarMensagem(bruto)).toEqual({
      tipo: "reg",
      registro: { sn: "1234567890", modelo: "AiFace", firmware: "ai518_fp26v_v1.27", usuarios: 204, rostos: 3 },
    });
  });

  it("sendlog de aluno cadastrado, com modo, sentido e hora de Brasília", () => {
    const bruto = JSON.stringify({
      cmd: "sendlog",
      sn: "1234567890",
      count: 1,
      logindex: 0,
      record: [{ enrollid: 300, name: "Nome do Usuário", time: "2025-02-26 11:40:19", mode: 8, inout: 0, event: 0 }],
    });
    const msg = interpretarMensagem(bruto);
    expect(msg).toEqual({
      tipo: "sendlog",
      sn: "1234567890",
      registros: [{ enrollid: 300, modo: 8, sentido: 0, evento: 0, hora: new Date("2025-02-26T14:40:19.000Z"), desconhecido: false }],
    });
  });

  it("rosto desconhecido: a foto que vem junto não sobra em lugar nenhum", () => {
    const bruto = JSON.stringify({
      cmd: "sendlog",
      sn: "1",
      count: 1,
      record: [{ enrollid: ENROLLID_DESCONHECIDO, name: "", time: "2023-12-27 10:05:00", mode: 1, inout: 0, event: 2, image: "data:image/jpeg;base64,/9j/4AAQ" }],
    });
    const msg = interpretarMensagem(bruto);
    expect(msg.tipo).toBe("sendlog");
    if (msg.tipo !== "sendlog") return;
    expect(msg.registros[0].desconhecido).toBe(true);
    expect(JSON.stringify(msg)).not.toContain("base64");
    expect(JSON.stringify(msg)).not.toContain("image");
  });

  it("respostas às ordens, com o motivo da falha (inclusive a grafia 'reson' do exemplo)", () => {
    expect(interpretarMensagem(JSON.stringify({ ret: "setuserinfo", sn: "1", result: true }))).toMatchObject({
      tipo: "resposta",
      ret: "setuserinfo",
      sucesso: true,
    });
    expect(interpretarMensagem(JSON.stringify({ ret: "deleteuser", result: false, reason: 1, msg: "have no data" }))).toMatchObject({
      sucesso: false,
      motivo: 1,
      mensagem: "have no data",
    });
    expect(interpretarMensagem(JSON.stringify({ ret: "senduser", result: false, reson: 1 }))).toMatchObject({ motivo: 1 });
  });

  it("lixo é ignorado; reg sem número de série também", () => {
    expect(interpretarMensagem("{")).toEqual({ tipo: "ignorado" });
    expect(interpretarMensagem(JSON.stringify({ cmd: "reg" }))).toEqual({ tipo: "ignorado" });
  });
});

describe("leitor facial Topdata: o que o Gateway responde e manda", () => {
  it("hora no formato do leitor, em Brasília", () => {
    expect(horaDoLeitor(AGORA)).toBe("2026-10-02 11:40:21");
    expect(lerHoraDoLeitor("2026-10-02 11:40:21")).toEqual(AGORA);
    expect(lerHoraDoLeitor("ontem")).toBeNull();
  });

  it("resposta ao reg é obrigatória e confirma a conexão", () => {
    expect(JSON.parse(respostaReg(AGORA))).toEqual({ ret: "reg", result: true, cloudtime: "2026-10-02 11:40:21" });
  });

  it("decisão: access e a frase pública da tela", () => {
    expect(JSON.parse(respostaAcesso(true, "Acesso liberado.", AGORA))).toEqual({
      ret: "sendlog",
      result: true,
      cloudtime: "2026-10-02 11:40:21",
      message: "Bem-vindo!",
      access: true,
    });
    expect(JSON.parse(respostaAcesso(false, "Mensalidade da academia em atraso.", AGORA))).toMatchObject({
      message: "Fale c/ recepcao",
      access: false,
    });
  });

  it("recebido: histórico nega por segurança; aviso de quem só identifica não decide nada", () => {
    expect(JSON.parse(respostaRecebido(true, AGORA))).toEqual({ ret: "sendlog", result: true, cloudtime: "2026-10-02 11:40:21", access: false });
    expect(JSON.parse(respostaRecebido(false, AGORA))).not.toHaveProperty("access");
  });

  it("pedido de acesso é um registro só, de agora; mais de um ou antigo é histórico", () => {
    const registro = (hora: Date | null) => ({ enrollid: 1, modo: 8, sentido: 0, evento: 0, hora, desconhecido: false });
    expect(ehPedidoDeAcesso([registro(new Date(AGORA.getTime() - 5_000))], AGORA)).toBe(true);
    expect(ehPedidoDeAcesso([registro(new Date(AGORA.getTime() - 10 * 60_000))], AGORA)).toBe(false);
    expect(ehPedidoDeAcesso([registro(AGORA), registro(AGORA)], AGORA)).toBe(false);
    expect(ehPedidoDeAcesso([registro(null)], AGORA)).toBe(true);
  });

  it("modo: quem decide fica só online e nega desconhecido; quem identifica fica offline", () => {
    expect(ordemModo(true)).toEqual({ cmd: "setdevinfo", server_verify: 1, stranger_lock: 0 });
    expect(ordemModo(false)).toEqual({ cmd: "setdevinfo", server_verify: 0, stranger_lock: 0 });
  });

  it("usuário com o nome 'Aluno' (a tela é pública); o cartão só para a Fit 4 Facial", () => {
    expect(ordemUsuario(42)).toEqual({ cmd: "setuserinfo", enrollid: 42, name: "Aluno", backupnum: 0, admin: 0, enable: 1, record: "0" });
    expect(ordemUsuario(42, { cartao: true })).toMatchObject({ card: 42 });
    expect(ordemApagar(42)).toEqual({ cmd: "deleteuser", enrollid: 42, backupnum: 0 });
  });

  it("apagar quem já não está no leitor conta como feito", () => {
    expect(apagarConcluido({ sucesso: true, motivo: null, mensagem: null })).toBe(true);
    expect(apagarConcluido({ sucesso: false, motivo: 1, mensagem: "can not find the user" })).toBe(true);
    expect(apagarConcluido({ sucesso: false, motivo: null, mensagem: "have no data" })).toBe(true);
    expect(apagarConcluido({ sucesso: false, motivo: 3, mensagem: "device busy" })).toBe(false);
  });
});
