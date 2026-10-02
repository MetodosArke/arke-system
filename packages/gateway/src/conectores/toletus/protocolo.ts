/**
 * Protocolo da placa Toletus LiteNet2 (antiga Actuar), porta TCP 7878.
 *
 * Transcrito do "Manual de Comandos Toletus LiteNet2" (manual V1.0.22,
 * firmware V2.1.1 R0), publicado pela própria Toletus em
 * github.com/Toletus/LiteNet2-ManuaisDeIntegracao. Diferente da Topdata,
 * aqui existe protocolo de fio aberto: pacotes de tamanho fixo, sem DLL.
 *
 *   | prefixo 0x53 | comando (2 bytes, little-endian) | dados (16 bytes) | sufixo 0xC3 |
 *
 * Texto vai em ASCII; número com mais de 8 bits, em little-endian. Pacote
 * com prefixo ou sufixo errado é ignorado pela placa, e por nós também.
 *
 * Este módulo é só tradução de bytes, sem rede: é a parte que o manual
 * define com exatidão, e por isso a que os testes conferem byte a byte.
 */

export const PORTA_TOLETUS = 7878;
export const TAMANHO_PACOTE = 20;
const PREFIXO = 0x53;
const SUFIXO = 0xc3;
const TAMANHO_DADOS = 16;

/** Ids de comando do manual (§2.2). Só os que o Gateway usa. */
export const COMANDO = {
  LIBERA_ENTRADA: 0x0001,
  LIBERA_SAIDA: 0x0002,
  MENSAGEM_TEMPORARIA: 0x0004,
  NOTIFICA_USUARIO: 0x0005,
  LIBERA_DOIS_SENTIDOS: 0x0006,
  CONSULTA_ID: 0x0103,
  CONSULTA_FIRMWARE: 0x010c,
  CONSULTA_SERIAL: 0x010d,
  ID_RFID: 0x0301,
  ID_CODIGO_BARRAS: 0x0302,
  ID_TECLADO: 0x0303,
  PASSAGEM: 0x0304,
  TEMPO_ESGOTADO: 0x0305,
  ID_BIOMETRIA: 0x0306,
  BIOMETRIA_NAO_CADASTRADA: 0x0307,
} as const;

/** Toques da notificação ao usuário (§2.3.1.5). */
export const TOQUE = { NENHUM: 0, BEEP: 1, ERRO: 2, AVISO: 3 } as const;

/** Cores dos leds na notificação ao usuário (§2.3.1.5). */
export const COR = { SEM_MUDAR: 0, VERMELHO: 1, VERDE_DOS_DOIS_LADOS: 5, AMARELO: 8 } as const;

export function montarPacote(comando: number, dados?: Buffer): Buffer {
  const pacote = Buffer.alloc(TAMANHO_PACOTE);
  pacote[0] = PREFIXO;
  pacote.writeUInt16LE(comando, 1);
  if (dados) dados.copy(pacote, 3, 0, Math.min(dados.length, TAMANHO_DADOS));
  pacote[TAMANHO_PACOTE - 1] = SUFIXO;
  return pacote;
}

/**
 * Texto para o display: 16 caracteres ASCII, completados com zeros. O
 * display não tem acento, então "Recepção" vira "Recepcao" em vez de lixo.
 */
export function textoParaDados(texto: string): Buffer {
  const ascii = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, TAMANHO_DADOS);
  const dados = Buffer.alloc(TAMANHO_DADOS);
  dados.write(ascii, "ascii");
  return dados;
}

/**
 * Notificação ao usuário (§2.3.1.5): duração em ms (16 bits), toque, cor
 * dos leds e se mostra a mensagem temporária definida antes por 0x0004.
 * A ordem dos campos segue a descrição dos argumentos no manual; a tabela
 * resumida do §2.2 lista os três primeiros, e o pacote oficial em C# monta
 * os bytes do mesmo jeito.
 */
export function dadosDaNotificacao(duracaoMs: number, toque: number, cor: number, mostrarTexto: boolean): Buffer {
  const dados = Buffer.alloc(TAMANHO_DADOS);
  dados.writeUInt16LE(Math.max(0, Math.min(0xffff, Math.round(duracaoMs))), 0);
  dados[2] = toque;
  dados[3] = cor;
  dados[4] = mostrarTexto ? 1 : 0;
  return dados;
}

export interface PacoteToletus {
  comando: number;
  dados: Buffer;
}

/**
 * Remonta pacotes a partir do que o socket entrega. O TCP não respeita a
 * fronteira de 20 bytes: um pacote pode chegar partido em duas leituras, ou
 * dois numa só. O pacote oficial em C# já corrige isso (o fatiamento em
 * blocos de 20 "descartava bytes quando uma mensagem cruzava a fronteira do
 * read").
 *
 * Vamos um passo além do pacote oficial: se um byte se perder, ele ficaria
 * desalinhado para sempre e descartaria todo pacote seguinte. Aqui, pacote
 * que não começa no prefixo ou não termina no sufixo faz o montador andar
 * um byte e procurar o próximo começo válido.
 */
export class MontadorDePacotes {
  private resto: Buffer = Buffer.alloc(0);
  descartados = 0;

  empurrar(pedaco: Buffer): PacoteToletus[] {
    this.resto = this.resto.length ? Buffer.concat([this.resto, pedaco]) : Buffer.from(pedaco);
    const pacotes: PacoteToletus[] = [];
    while (this.resto.length >= TAMANHO_PACOTE) {
      if (this.resto[0] !== PREFIXO || this.resto[TAMANHO_PACOTE - 1] !== SUFIXO) {
        this.resto = this.resto.subarray(1);
        this.descartados++;
        continue;
      }
      const pacote = this.resto.subarray(0, TAMANHO_PACOTE);
      pacotes.push({ comando: pacote.readUInt16LE(1), dados: Buffer.from(pacote.subarray(3, 3 + TAMANHO_DADOS)) });
      this.resto = this.resto.subarray(TAMANHO_PACOTE);
    }
    return pacotes;
  }
}

export type OrigemIdentificacao = "rfid" | "codigo_barras" | "teclado" | "biometria";

export type EventoToletus =
  | { tipo: "identificacao"; origem: OrigemIdentificacao; valor: string }
  | { tipo: "passagem"; direcao: "entrada" | "saida"; total: number }
  | { tipo: "tempo_esgotado" }
  | { tipo: "biometria_nao_cadastrada" }
  | { tipo: "resposta"; comando: number; dados: Buffer };

/** Texto ASCII dos dados, sem os zeros de preenchimento nem espaços. */
function textoDosDados(dados: Buffer): string {
  const fim = dados.indexOf(0);
  return dados
    .subarray(0, fim === -1 ? dados.length : fim)
    .toString("ascii")
    .trim();
}

/**
 * O que um pacote recebido da placa significa. Notificações (§2.3.3) chegam
 * sem pedido; o resto é resposta a uma consulta nossa.
 *
 * Cartão, código de barras e teclado chegam como texto numérico de até 16
 * caracteres. O número do cartão vale sem os zeros à esquerda, para o mesmo
 * cartão dar o mesmo identificador venha ele com 8 ou com 16 dígitos. A
 * biometria chega como o número de 16 bits com que o usuário foi cadastrado
 * no leitor.
 */
export function interpretarPacote(p: PacoteToletus): EventoToletus {
  switch (p.comando) {
    case COMANDO.ID_RFID:
    case COMANDO.ID_CODIGO_BARRAS:
    case COMANDO.ID_TECLADO: {
      const texto = textoDosDados(p.dados);
      const origem: OrigemIdentificacao =
        p.comando === COMANDO.ID_RFID ? "rfid" : p.comando === COMANDO.ID_CODIGO_BARRAS ? "codigo_barras" : "teclado";
      // Teclado preserva os zeros: CPF começa com zero muitas vezes.
      const valor = origem === "teclado" ? texto : texto.replace(/^0+(?=.)/, "");
      return { tipo: "identificacao", origem, valor };
    }
    case COMANDO.ID_BIOMETRIA:
      return { tipo: "identificacao", origem: "biometria", valor: String(p.dados.readUInt16LE(0)) };
    case COMANDO.PASSAGEM:
      // 1 = entrada, 2 = saída (§2.3.3.4); o contador é o total naquela direção.
      return { tipo: "passagem", direcao: p.dados[0] === 2 ? "saida" : "entrada", total: p.dados.readUInt32LE(1) };
    case COMANDO.TEMPO_ESGOTADO:
      return { tipo: "tempo_esgotado" };
    case COMANDO.BIOMETRIA_NAO_CADASTRADA:
      return { tipo: "biometria_nao_cadastrada" };
    default:
      return { tipo: "resposta", comando: p.comando, dados: p.dados };
  }
}

/** Versão de firmware na resposta de 0x010C: principal.secundária.correção R revisão. */
export function versaoDoFirmware(dados: Buffer): string {
  return `V${dados[0]}.${dados[1]}.${dados[2]} R${dados[3]}`;
}

/**
 * Frase do display (16 caracteres) para cada decisão. O motivo completo
 * fica no registro; o display da catraca é público, então "mensalidade em
 * atraso" não aparece para a fila inteira ler: a recepção resolve.
 */
export function mensagemDoDisplay(liberado: boolean, motivo: string): string {
  if (liberado) return "Bem-vindo!";
  const m = motivo.toLowerCase();
  if (m.includes("não encontrado") || m.includes("nao encontrado")) return "Nao cadastrado";
  // Falha nossa ao conferir não é "sem agendamento": diria ao aluno algo falso.
  if (m.includes("tente novamente")) return "Tente novamente";
  if (m.includes("agendamento")) return "Sem agendamento";
  if (m.includes("sem conexão") || m.includes("sem conexao")) return "Sem conexao";
  if (m.includes("dispositivo")) return "Catraca inativa";
  if (m.includes("pausad") || m.includes("atraso") || m.includes("recepç")) return "Fale c/ recepcao";
  return "Acesso negado";
}
