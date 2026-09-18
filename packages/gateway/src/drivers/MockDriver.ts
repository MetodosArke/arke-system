import { EventEmitter } from "node:events";
import type { CatracaDriver } from "./CatracaDriver";
import type { LeituraCredencial } from "../types";
import { logger } from "../logger";

/**
 * Driver funcional (sem hardware real) usado em desenvolvimento, demos e
 * nos testes automatizados (`modelo_catraca: "mock"` no config.json).
 * Não abre socket nenhum — expõe `simularLeitura()` para injetar uma
 * leitura de credencial como se tivesse vindo da catraca física, e
 * registra no log o que faria de verdade (destravar/negar).
 */
export class MockDriver implements CatracaDriver {
  readonly modelo = "mock";
  private readonly emissor = new EventEmitter();
  private conectado = false;

  async conectar(): Promise<void> {
    this.conectado = true;
    logger.info({ driver: this.modelo }, "Driver mock conectado (sem hardware real)");
  }

  async desconectar(): Promise<void> {
    this.conectado = false;
  }

  aoLerCredencial(callback: (leitura: LeituraCredencial) => void): void {
    this.emissor.on("leitura", callback);
  }

  /** Uso em testes/demo: injeta uma leitura como se tivesse vindo do hardware. */
  simularLeitura(leitura: LeituraCredencial): void {
    if (!this.conectado) throw new Error("Driver mock não está conectado.");
    this.emissor.emit("leitura", leitura);
  }

  async liberarAcesso(nomeAluno: string): Promise<void> {
    logger.info({ driver: this.modelo, nomeAluno }, "Giro liberado (mock)");
  }

  async negarAcesso(motivo: string): Promise<void> {
    logger.info({ driver: this.modelo, motivo }, "Acesso negado (mock)");
  }
}
