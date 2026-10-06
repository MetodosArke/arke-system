import type { CatracaDriver } from "./CatracaDriver";
import type { LeituraCredencial } from "../types";
import { logger } from "../logger";

/**
 * Driver nulo para fabricantes em que o equipamento é o cliente.
 *
 * Control iD (e, pelo manual, também Topdata) não esperam que o servidor
 * disque para elas a cada acesso: a catraca abre a conexão, manda o evento
 * e recebe a decisão na resposta da mesma requisição. Nesse desenho não há
 * o que "conectar" nem comando de liberação a enviar depois — quem gira a
 * borboleta é o JSON que o receptor devolve.
 *
 * Este objeto existe para o GatewayService continuar com um contrato só,
 * sem um `if (modelo === ...)` espalhado pelo orquestrador. Os métodos são
 * inertes de propósito, e dizem isso em voz alta no log se alguém os
 * chamar — silêncio aqui esconderia fiação errada.
 */
export class ReceptorDriver implements CatracaDriver {
  readonly modelo: string;
  private readonly comoOpera: string;

  /**
   * `comoOpera` é a frase do log de partida. A Toletus usa este mesmo driver
   * inerte pelo motivo oposto (quem disca é o Gateway, pelo conector), e o
   * log precisa dizer a verdade sobre qual dos dois caminhos está em uso.
   */
  constructor(modelo: string, comoOpera = "Modelo opera por escuta: quem abre a conexão é a catraca, o gateway não disca") {
    this.modelo = modelo;
    this.comoOpera = comoOpera;
  }

  async conectar(): Promise<void> {
    logger.info({ modelo: this.modelo }, this.comoOpera);
  }

  async desconectar(): Promise<void> {}

  aoLerCredencial(_callback: (leitura: LeituraCredencial) => void): void {
    // As leituras entram pelas rotas HTTP do receptor, não por callback.
  }

  async liberarAcesso(mensagem: string): Promise<void> {
    logger.warn(
      { modelo: this.modelo, mensagem },
      "liberarAcesso chamado num modelo de escuta — a liberação vai na resposta HTTP, não por comando"
    );
  }

  async negarAcesso(motivo: string): Promise<void> {
    logger.warn(
      { modelo: this.modelo, motivo },
      "negarAcesso chamado num modelo de escuta — a negativa vai na resposta HTTP, não por comando"
    );
  }
}
