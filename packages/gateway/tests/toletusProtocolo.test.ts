import { describe, it, expect } from "vitest";
import {
  COMANDO,
  COR,
  MontadorDePacotes,
  TOQUE,
  dadosDaNotificacao,
  interpretarPacote,
  mensagemDoDisplay,
  montarPacote,
  textoParaDados,
  versaoDoFirmware,
} from "../src/conectores/toletus/protocolo";

/**
 * O protocolo da LiteNet2 é público e exato (manual V1.0.22, firmware
 * V2.1.1 R0, github.com/Toletus/LiteNet2-ManuaisDeIntegracao). Por isso
 * estes testes conferem byte a byte, e não "algo parecido": a placa ignora
 * em silêncio todo pacote com um byte fora do lugar.
 */

const hex = (b: Buffer) => b.toString("hex").match(/../g)!.join(" ");

describe("protocolo Toletus LiteNet2: montagem", () => {
  it("consulta de id é o exemplo do próprio manual (§2.3.2)", () => {
    // Manual: "Enviado: 53 03 01 00 … 00 c3" — prefixo, comando 0x0103 em
    // little-endian, 16 bytes de dados zerados, sufixo.
    expect(hex(montarPacote(COMANDO.CONSULTA_ID))).toBe(`53 03 01 ${"00 ".repeat(16)}c3`);
  });

  it("liberação de entrada leva a mensagem em ASCII, completada com zeros", () => {
    const p = montarPacote(COMANDO.LIBERA_ENTRADA, textoParaDados("Bem-vindo!"));
    expect(p.length).toBe(20);
    expect(p[0]).toBe(0x53);
    expect(p.readUInt16LE(1)).toBe(0x0001);
    expect(p.subarray(3, 13).toString("ascii")).toBe("Bem-vindo!");
    expect([...p.subarray(13, 19)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(p[19]).toBe(0xc3);
  });

  it("o display não tem acento: o texto sai sem acento e com no máximo 16 caracteres", () => {
    expect(textoParaDados("Recepção").toString("ascii").replace(/\0+$/, "")).toBe("Recepcao");
    expect(textoParaDados("Mensagem longa demais para o display").toString("ascii")).toBe("Mensagem longa d");
    expect(textoParaDados("Olá 😀").toString("ascii").replace(/\0+$/, "")).toBe("Ola ??");
  });

  it("notificação: duração em 16 bits little-endian, toque, cor e mostrar texto (§2.3.1.5)", () => {
    const d = dadosDaNotificacao(3000, TOQUE.ERRO, COR.VERMELHO, true);
    expect([...d.subarray(0, 5)]).toEqual([0xb8, 0x0b, 2, 1, 1]);
    expect([...d.subarray(5)]).toEqual(new Array(11).fill(0));
  });
});

describe("protocolo Toletus LiteNet2: remontagem do que o socket entrega", () => {
  const consultaId = montarPacote(COMANDO.CONSULTA_ID);
  const cartao = montarPacote(COMANDO.ID_RFID, textoParaDados("0000003954862189"));

  it("pacote partido em duas leituras sai inteiro, uma vez só", () => {
    const m = new MontadorDePacotes();
    expect(m.empurrar(cartao.subarray(0, 7))).toEqual([]);
    const saida = m.empurrar(cartao.subarray(7));
    expect(saida).toHaveLength(1);
    expect(saida[0].comando).toBe(COMANDO.ID_RFID);
  });

  it("dois pacotes numa leitura saem os dois, na ordem", () => {
    const saida = new MontadorDePacotes().empurrar(Buffer.concat([consultaId, cartao]));
    expect(saida.map((p) => p.comando)).toEqual([COMANDO.CONSULTA_ID, COMANDO.ID_RFID]);
  });

  it("lixo antes do pacote não desalinha o que vem depois", () => {
    const m = new MontadorDePacotes();
    const saida = m.empurrar(Buffer.concat([Buffer.from([0x01, 0x02, 0x03]), cartao, consultaId]));
    expect(saida.map((p) => p.comando)).toEqual([COMANDO.ID_RFID, COMANDO.CONSULTA_ID]);
    expect(m.descartados).toBe(3);
  });

  it("pacote com sufixo errado é descartado e o seguinte é recuperado", () => {
    const corrompido = Buffer.from(cartao);
    corrompido[19] = 0x00;
    const saida = new MontadorDePacotes().empurrar(Buffer.concat([corrompido, consultaId]));
    expect(saida.map((p) => p.comando)).toEqual([COMANDO.CONSULTA_ID]);
  });
});

describe("protocolo Toletus LiteNet2: o que cada notificação significa", () => {
  const interpretar = (comando: number, dados?: Buffer) =>
    interpretarPacote({ comando, dados: dados ?? Buffer.alloc(16) });

  it("cartão vale sem os zeros à esquerda: o mesmo cartão, com 8 ou 16 dígitos, é o mesmo aluno", () => {
    expect(interpretar(COMANDO.ID_RFID, textoParaDados("0000003954862189"))).toEqual({
      tipo: "identificacao",
      origem: "rfid",
      valor: "3954862189",
    });
    expect(interpretar(COMANDO.ID_RFID, textoParaDados("3954862189"))).toMatchObject({ valor: "3954862189" });
    expect(interpretar(COMANDO.ID_CODIGO_BARRAS, textoParaDados("000123"))).toMatchObject({
      origem: "codigo_barras",
      valor: "123",
    });
    expect(interpretar(COMANDO.ID_RFID, textoParaDados("0000"))).toMatchObject({ valor: "0" });
  });

  it("teclado preserva o zero à esquerda, porque CPF começa com zero muitas vezes", () => {
    expect(interpretar(COMANDO.ID_TECLADO, textoParaDados("01234567890"))).toMatchObject({
      origem: "teclado",
      valor: "01234567890",
    });
  });

  it("biometria é o número de 16 bits com que o usuário foi cadastrado no leitor", () => {
    const d = Buffer.alloc(16);
    d.writeUInt16LE(300, 0);
    expect(interpretar(COMANDO.ID_BIOMETRIA, d)).toEqual({ tipo: "identificacao", origem: "biometria", valor: "300" });
    expect(interpretar(COMANDO.BIOMETRIA_NAO_CADASTRADA)).toEqual({ tipo: "biometria_nao_cadastrada" });
  });

  it("passagem diz a direção (1 entrada, 2 saída) e o contador; tempo esgotado é o não girou", () => {
    const entrada = Buffer.alloc(16);
    entrada[0] = 1;
    entrada.writeUInt32LE(70000, 1);
    expect(interpretar(COMANDO.PASSAGEM, entrada)).toEqual({ tipo: "passagem", direcao: "entrada", total: 70000 });
    const saida = Buffer.alloc(16);
    saida[0] = 2;
    expect(interpretar(COMANDO.PASSAGEM, saida)).toMatchObject({ direcao: "saida" });
    expect(interpretar(COMANDO.TEMPO_ESGOTADO)).toEqual({ tipo: "tempo_esgotado" });
  });

  it("o resto é resposta a uma consulta nossa", () => {
    expect(interpretar(COMANDO.CONSULTA_ID)).toMatchObject({ tipo: "resposta", comando: COMANDO.CONSULTA_ID });
    expect(versaoDoFirmware(Buffer.from([2, 1, 1, 0]))).toBe("V2.1.1 R0");
  });
});

describe("protocolo Toletus LiteNet2: frase do display", () => {
  // Motivos que a catraca-validar-acesso devolve hoje, mais os do cache.
  const casos: [boolean, string, string][] = [
    [true, "Acesso liberado.", "Bem-vindo!"],
    [false, "Aluno não encontrado nesta academia.", "Nao cadastrado"],
    [false, "Aluno não encontrado no cache local.", "Nao cadastrado"],
    [false, "Matrícula pausada. Procure a recepção.", "Fale c/ recepcao"],
    [false, "Mensalidade da academia em atraso.", "Fale c/ recepcao"],
    [false, "Assinatura em atraso (validado pelo cache local).", "Fale c/ recepcao"],
    // Os textos da nuvem e do cache desde 06/10/2026: pausado, inadimplente e
    // matrícula encerrada dizem só para procurar a recepção.
    [false, "Procure a recepção.", "Fale c/ recepcao"],
    [false, "Procure a recepção (validado pelo cache local).", "Fale c/ recepcao"],
    [false, "Sem agendamento ativo para este horário.", "Sem agendamento"],
    [false, "Dispositivo inativo.", "Catraca inativa"],
    [false, "Sem conexão com a nuvem e cache local ainda vazio.", "Sem conexao"],
    [false, "Falha ao verificar agendamento. Tente novamente.", "Tente novamente"],
    [false, "qualquer outra coisa", "Acesso negado"],
  ];

  it.each(casos)("liberado=%s, %s → %s", (liberado, motivo, display) => {
    expect(mensagemDoDisplay(liberado, motivo)).toBe(display);
  });

  it("nenhuma frase passa de 16 caracteres nem fala de dinheiro para a fila ler", () => {
    for (const [liberado, motivo] of casos) {
      const frase = mensagemDoDisplay(liberado, motivo);
      expect(frase.length).toBeLessThanOrEqual(16);
      expect(frase.toLowerCase()).not.toMatch(/atraso|mensalidade|pausad/);
    }
  });
});
