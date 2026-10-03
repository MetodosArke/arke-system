/**
 * Protocolo do leitor de digital CAMA-SM25, que a Toletus monta nas
 * catracas com placa LiteNet2. A placa expõe o leitor na porta TCP 7879 do
 * mesmo IP (a 7878 é a da catraca), e é por ali que o ARKE cadastra e apaga
 * a digital do aluno.
 *
 * Transcrito do "CAMA-SM25 Series Fingerprint Identification Module User's
 * Manual" (Shenzhen CAMA Biometrics), que a própria Toletus publica em
 * github.com/Toletus/LiteNet2-ExemploIntegracao, e conferido contra o pacote
 * oficial github.com/Toletus/sm25biometricreader-package. Quatro tipos de
 * pacote, todos com números em little-endian:
 *
 *   comando            | 55 AA | cmd (2) | len (2) | parâmetro (16)          | soma (2) |  24 bytes
 *   resposta           | AA 55 | cmd (2) | len (2) | ret (2) | dados (14)    | soma (2) |  24 bytes
 *   dados do comando   | 5A A5 | cmd (2) | len = n | dados (n)               | soma (2) |  n + 8
 *   dados da resposta  | A5 5A | cmd (2) | len = n | ret (2) | dados (n - 2) | soma (2) |  n + 8
 *
 * A soma é a palavra baixa da soma de todos os bytes antes dela. `ret` é 0
 * no sucesso e 1 na falha; na falha, os dois primeiros bytes dos dados são
 * o código do erro.
 *
 * O que o leitor guarda de cada digital é um "registro" de 498 bytes: 496 de
 * modelo e 2 de soma. É dado biométrico: atravessa a memória do Gateway na
 * cópia entre leitores e nunca vai para log, resultado ou nuvem.
 *
 * Este módulo é só tradução de bytes, sem rede: é a parte que o manual
 * define com exatidão, e por isso a que os testes conferem byte a byte.
 */

export const PORTA_LEITOR_SM25 = 7879;

/** Os prefixos, como palavra de 16 bits (§4.3.1): 0xAA55 sai como 55 AA. */
export const PREFIXO = {
  COMANDO: 0xaa55,
  RESPOSTA: 0x55aa,
  DADOS_COMANDO: 0xa55a,
  DADOS_RESPOSTA: 0x5aa5,
} as const;

/** Os comandos que o Gateway usa (§5.2). */
export const COMANDO_SM25 = {
  CADASTRAR: 0x0103,
  APAGAR: 0x0105,
  SITUACAO_DO_NUMERO: 0x0108,
  LER_REGISTRO: 0x010a,
  GRAVAR_REGISTRO: 0x010b,
  DEFINIR_TEMPO_DO_DEDO: 0x010e,
  TEMPO_DO_DEDO: 0x010f,
  CANCELAR: 0x0130,
  TESTAR_CONEXAO: 0x0150,
  /** Resposta do leitor a um pacote que ele não entendeu (§5.3.37). */
  COMANDO_INCORRETO: 0x0160,
} as const;

/** Códigos de erro (§6.1). */
export const ERRO_SM25 = {
  NUMERO_VAZIO: 0x13,
  NUMERO_OCUPADO: 0x14,
  DIGITAL_REPETIDA: 0x19,
  QUALIDADE_RUIM: 0x21,
  TEMPO_ESGOTADO: 0x23,
  SEM_SENHA: 0x24,
  FALHA_AO_UNIR: 0x30,
  CANCELADO: 0x41,
  NUMERO_INVALIDO: 0x60,
  TEMPO_INVALIDO: 0x62,
  PARAMETRO_INVALIDO: 0x70,
} as const;

/** Os passos do cadastro, que chegam como resposta de sucesso (§5.3.3). */
export const PASSO = {
  PRIMEIRO_TOQUE: 0xfff1,
  SEGUNDO_TOQUE: 0xfff2,
  TERCEIRO_TOQUE: 0xfff3,
  TIRAR_O_DEDO: 0xfff4,
} as const;

/** Situação de um número (§5.3.8). */
export const NUMERO_OCUPADO = 0x01;

/** Registro de uma digital: 496 bytes de modelo + 2 de soma (§5.1). */
export const TAMANHO_REGISTRO = 498;
const TAMANHO_MODELO = 496;
const TAMANHO_COMANDO = 24;
const TAMANHO_PARAMETRO = 16;
/** O manual limita o pacote de dados a 512 bytes de conteúdo (§4.2.3). */
const MAXIMO_DADOS = 512;

/** O maior número que cabe no campo de 2 bytes. O leitor pode aceitar menos (capacidade de 3.000 digitais). */
export const MAIOR_NUMERO = 0xffff;

export function soma(pacote: Buffer, ate: number): number {
  let s = 0;
  for (let i = 0; i < ate; i++) s += pacote[i];
  return s & 0xffff;
}

/**
 * Pacote de comando (§4.3.2). O parâmetro numérico vai em 2 bytes; o campo
 * de 16 bytes é completado com zeros, e `len` diz quantos valem.
 */
export function montarComando(comando: number, parametro?: number | Buffer): Buffer {
  const dados =
    parametro === undefined
      ? Buffer.alloc(0)
      : typeof parametro === "number"
        ? (() => {
            const b = Buffer.alloc(2);
            b.writeUInt16LE(parametro & 0xffff, 0);
            return b;
          })()
        : parametro;
  if (dados.length > TAMANHO_PARAMETRO) throw new Error("Parâmetro maior que 16 bytes: use um pacote de dados.");
  const p = Buffer.alloc(TAMANHO_COMANDO);
  p.writeUInt16LE(PREFIXO.COMANDO, 0);
  p.writeUInt16LE(comando, 2);
  p.writeUInt16LE(dados.length, 4);
  dados.copy(p, 6);
  p.writeUInt16LE(soma(p, TAMANHO_COMANDO - 2), TAMANHO_COMANDO - 2);
  return p;
}

/** Pacote de dados do comando (§4.3.4): o que não cabe em 16 bytes, como o registro de uma digital. */
export function montarDadosDoComando(comando: number, dados: Buffer): Buffer {
  if (dados.length >= MAXIMO_DADOS) throw new Error("Dados maiores que o pacote do leitor aceita.");
  const p = Buffer.alloc(dados.length + 8);
  p.writeUInt16LE(PREFIXO.DADOS_COMANDO, 0);
  p.writeUInt16LE(comando, 2);
  p.writeUInt16LE(dados.length, 4);
  dados.copy(p, 6);
  p.writeUInt16LE(soma(p, p.length - 2), p.length - 2);
  return p;
}

/**
 * Os dados de gravar uma digital (§5.3.11): o número e o registro. O
 * chamador zera o buffer depois de enviar.
 */
export function dadosDeGravacao(numero: number, registro: Buffer): Buffer {
  const d = Buffer.alloc(2 + TAMANHO_REGISTRO);
  d.writeUInt16LE(numero & 0xffff, 0);
  registro.copy(d, 2, 0, TAMANHO_REGISTRO);
  return d;
}

export type TipoPacoteSM25 = "comando" | "resposta" | "dados_comando" | "dados_resposta";

export interface PacoteSM25 {
  tipo: TipoPacoteSM25;
  comando: number;
  /** 0 sucesso, 1 falha. Só nas respostas. */
  ret: number | null;
  /** Nas respostas, o que vem depois do `ret`; nos comandos, o parâmetro ou os dados. */
  dados: Buffer;
}

/** Os dois primeiros bytes dos dados: o número, o passo do cadastro ou o código do erro. */
export function valorDe(p: PacoteSM25): number {
  return p.dados.length >= 2 ? p.dados.readUInt16LE(0) : 0;
}

/** O registro é coerente? Os dois últimos bytes são a soma dos 496 anteriores (§5.1). */
export function registroValido(registro: Buffer): boolean {
  return registro.length === TAMANHO_REGISTRO && soma(registro, TAMANHO_MODELO) === registro.readUInt16LE(TAMANHO_MODELO);
}

/**
 * Remonta os pacotes a partir do fluxo TCP. O leitor fala por UART e a
 * placa repassa os bytes: nada garante que um pacote chegue inteiro num
 * pedaço só, nem que dois não venham colados. Byte fora de pacote, ou pacote
 * com soma errada, é descartado um byte por vez até o próximo prefixo — sem
 * isso, um byte perdido desalinharia todo o resto da conversa.
 */
export class MontadorSM25 {
  private resto = Buffer.alloc(0);

  adicionar(pedaco: Buffer): PacoteSM25[] {
    this.resto = this.resto.length ? Buffer.concat([this.resto, pedaco]) : Buffer.from(pedaco);
    const pacotes: PacoteSM25[] = [];
    while (this.resto.length >= 2) {
      const prefixo = this.resto.readUInt16LE(0);
      const tipo = tipoDoPrefixo(prefixo);
      if (!tipo) {
        this.resto = this.resto.subarray(1);
        continue;
      }
      let total: number;
      if (tipo === "comando" || tipo === "resposta") {
        total = TAMANHO_COMANDO;
      } else {
        if (this.resto.length < 6) break;
        const n = this.resto.readUInt16LE(4);
        if (n > MAXIMO_DADOS || (tipo === "dados_resposta" && n < 2)) {
          this.resto = this.resto.subarray(1);
          continue;
        }
        total = n + 8;
      }
      if (this.resto.length < total) break;
      const bruto = this.resto.subarray(0, total);
      if (soma(bruto, total - 2) !== bruto.readUInt16LE(total - 2)) {
        this.resto = this.resto.subarray(1);
        continue;
      }
      pacotes.push(interpretar(tipo, bruto));
      this.resto = this.resto.subarray(total);
    }
    return pacotes;
  }

  /** Descarta o que estiver guardado (pode ser pedaço de registro de digital). */
  limpar(): void {
    this.resto.fill(0);
    this.resto = Buffer.alloc(0);
  }
}

function tipoDoPrefixo(prefixo: number): TipoPacoteSM25 | null {
  switch (prefixo) {
    case PREFIXO.COMANDO:
      return "comando";
    case PREFIXO.RESPOSTA:
      return "resposta";
    case PREFIXO.DADOS_COMANDO:
      return "dados_comando";
    case PREFIXO.DADOS_RESPOSTA:
      return "dados_resposta";
    default:
      return null;
  }
}

function interpretar(tipo: TipoPacoteSM25, bruto: Buffer): PacoteSM25 {
  const comando = bruto.readUInt16LE(2);
  const len = bruto.readUInt16LE(4);
  // Cópia: o buffer do montador é reaproveitado, e quem recebe o pacote pode zerá-lo.
  switch (tipo) {
    case "comando":
      return { tipo, comando, ret: null, dados: Buffer.from(bruto.subarray(6, 6 + Math.min(len, TAMANHO_PARAMETRO))) };
    case "resposta":
      return {
        tipo,
        comando,
        ret: bruto.readUInt16LE(6),
        dados: Buffer.from(bruto.subarray(8, 8 + Math.max(0, Math.min(len, TAMANHO_PARAMETRO) - 2))),
      };
    case "dados_comando":
      return { tipo, comando, ret: null, dados: Buffer.from(bruto.subarray(6, 6 + len)) };
    case "dados_resposta":
      return { tipo, comando, ret: bruto.readUInt16LE(6), dados: Buffer.from(bruto.subarray(8, 6 + len)) };
  }
}

/** O código de erro do leitor em palavras de recepção. */
export function mensagemDoErroSM25(codigo: number): string {
  switch (codigo) {
    case ERRO_SM25.NUMERO_VAZIO:
      return "não há digital neste número";
    case ERRO_SM25.NUMERO_OCUPADO:
      return "já há uma digital neste número";
    case ERRO_SM25.DIGITAL_REPETIDA:
      return "esta digital já está cadastrada no leitor";
    case ERRO_SM25.QUALIDADE_RUIM:
      return "a leitura saiu ruim: limpe o leitor e o dedo e tente de novo";
    case ERRO_SM25.TEMPO_ESGOTADO:
      return "o aluno não pôs o dedo a tempo";
    case ERRO_SM25.SEM_SENHA:
      return "o leitor tem senha de dispositivo, que o ARKE não usa";
    case ERRO_SM25.FALHA_AO_UNIR:
      return "as três leituras não bateram: use o mesmo dedo nas três vezes";
    case ERRO_SM25.CANCELADO:
      return "o cadastro foi cancelado";
    case ERRO_SM25.NUMERO_INVALIDO:
      return "o número passa do que o leitor guarda";
    case ERRO_SM25.TEMPO_INVALIDO:
      return "o leitor recusou o tempo de espera do dedo";
    case ERRO_SM25.PARAMETRO_INVALIDO:
      return "o leitor recusou o registro da digital";
    default:
      return `o leitor respondeu com o erro 0x${codigo.toString(16).padStart(2, "0")}`;
  }
}
