import type { CatracaDriver } from "./CatracaDriver";
import type { LeituraCredencial } from "../types";
import { TcpDriverBase } from "./TcpDriverBase";
import { logger } from "../logger";

/**
 * ⚠️ STUB — protocolo proprietário não implementado.
 *
 * A Topdata normalmente disponibiliza um SDK/DLL próprio (TopFace/
 * Topdata SDK) para integração com seus terminais. Este arquivo cuida da
 * conexão TCP genérica (ver TcpDriverBase) — a codificação/decodificação
 * real precisa ser preenchida aqui a partir da documentação oficial da
 * Topdata. Ver ControlIdDriver.ts para o formato esperado de cada método.
 */
export class TopdataDriver implements CatracaDriver {
  readonly modelo = "topdata";
  private readonly tcp: TcpDriverBase;

  constructor(host: string, porta: number) {
    this.tcp = new TcpDriverBase(host, porta);
  }

  async conectar(): Promise<void> {
    await this.tcp.conectar();
    this.tcp.on("data", (chunk: Buffer) => {
      logger.debug({ bytes: chunk.length }, "Bytes recebidos da catraca Topdata (protocolo não decodificado)");
      // TODO: decodificar conforme o SDK Topdata.
    });
  }

  async desconectar(): Promise<void> {
    await this.tcp.desconectar();
  }

  aoLerCredencial(_callback: (leitura: LeituraCredencial) => void): void {
    // TODO: registrar o callback e disparar quando o protocolo real for decodificado.
  }

  async liberarAcesso(_nomeAluno: string): Promise<void> {
    throw new Error("TopdataDriver.liberarAcesso: protocolo Topdata ainda não implementado.");
  }

  async negarAcesso(_motivo: string): Promise<void> {
    throw new Error("TopdataDriver.negarAcesso: protocolo Topdata ainda não implementado.");
  }
}
