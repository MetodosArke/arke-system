import type { CatracaDriver } from "./CatracaDriver";
import type { LeituraCredencial } from "../types";
import { TcpDriverBase } from "./TcpDriverBase";
import { logger } from "../logger";

/**
 * ⚠️ STUB — protocolo proprietário não implementado.
 *
 * A Control iD expõe as catracas iDAccess/iDFlex normalmente via uma API
 * REST/HTTP própria do equipamento (não um protocolo binário TCP solto),
 * documentada no "Control iD Access SDK". Este arquivo faz a parte
 * genérica (conectar/desconectar via TCP, ver TcpDriverBase) mas NÃO
 * inventa o formato dos pacotes — os métodos abaixo lançam erro até
 * alguém da ARKE preencher a codificação/decodificação real a partir da
 * documentação oficial do fabricante (ou trocar a abordagem para
 * consumir a API HTTP do equipamento em vez de TCP cru, se for o caso).
 *
 * Onde plugar o protocolo real:
 *   - `aoLerCredencial`: parsear os bytes recebidos em `tcp.on("data", ...)`
 *     e traduzir para { tipo, valor, lidoEm }.
 *   - `liberarAcesso`/`negarAcesso`: montar o pacote de comando do
 *     equipamento (ou chamar o endpoint HTTP correspondente) e chamar
 *     `tcp.enviar(buffer)`.
 */
export class ControlIdDriver implements CatracaDriver {
  readonly modelo = "controlid";
  private readonly tcp: TcpDriverBase;

  constructor(host: string, porta: number) {
    this.tcp = new TcpDriverBase(host, porta);
  }

  async conectar(): Promise<void> {
    await this.tcp.conectar();
    this.tcp.on("data", (chunk: Buffer) => {
      logger.debug({ bytes: chunk.length }, "Bytes recebidos da catraca Control iD (protocolo não decodificado)");
      // TODO: decodificar `chunk` conforme o SDK da Control iD e chamar
      // os callbacks registrados via aoLerCredencial().
    });
  }

  async desconectar(): Promise<void> {
    await this.tcp.desconectar();
  }

  aoLerCredencial(_callback: (leitura: LeituraCredencial) => void): void {
    // TODO: registrar o callback e disparar quando o protocolo real for decodificado.
  }

  async liberarAcesso(_nomeAluno: string): Promise<void> {
    throw new Error(
      "ControlIdDriver.liberarAcesso: protocolo da Control iD ainda não implementado. " +
        "Consulte o SDK oficial do fabricante antes de usar em produção."
    );
  }

  async negarAcesso(_motivo: string): Promise<void> {
    throw new Error(
      "ControlIdDriver.negarAcesso: protocolo da Control iD ainda não implementado. " +
        "Consulte o SDK oficial do fabricante antes de usar em produção."
    );
  }
}
