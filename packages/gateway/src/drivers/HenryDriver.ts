import type { CatracaDriver } from "./CatracaDriver";
import type { LeituraCredencial } from "../types";
import { TcpDriverBase } from "./TcpDriverBase";
import { logger } from "../logger";

/**
 * ⚠️ STUB — protocolo proprietário não implementado.
 *
 * Os equipamentos Henry (Primme, Vertx etc.) costumam falar um protocolo
 * TCP próprio (ex.: "Protocolo Henry 5001/6000") documentado apenas para
 * integradores cadastrados junto ao fabricante. Este arquivo cuida da
 * conexão TCP genérica (ver TcpDriverBase) — a codificação/decodificação
 * real dos pacotes Henry precisa ser preenchida aqui a partir da
 * documentação oficial obtida com a Henry antes de qualquer teste com
 * equipamento real. Ver ControlIdDriver.ts para o formato esperado de
 * cada método.
 */
export class HenryDriver implements CatracaDriver {
  readonly modelo = "henry";
  private readonly tcp: TcpDriverBase;

  constructor(host: string, porta: number) {
    this.tcp = new TcpDriverBase(host, porta);
  }

  async conectar(): Promise<void> {
    await this.tcp.conectar();
    this.tcp.on("data", (chunk: Buffer) => {
      logger.debug({ bytes: chunk.length }, "Bytes recebidos da catraca Henry (protocolo não decodificado)");
      // TODO: decodificar conforme o protocolo Henry.
    });
  }

  async desconectar(): Promise<void> {
    await this.tcp.desconectar();
  }

  aoLerCredencial(_callback: (leitura: LeituraCredencial) => void): void {
    // TODO: registrar o callback e disparar quando o protocolo real for decodificado.
  }

  async liberarAcesso(_nomeAluno: string): Promise<void> {
    throw new Error("HenryDriver.liberarAcesso: protocolo Henry ainda não implementado.");
  }

  async negarAcesso(_motivo: string): Promise<void> {
    throw new Error("HenryDriver.negarAcesso: protocolo Henry ainda não implementado.");
  }
}
