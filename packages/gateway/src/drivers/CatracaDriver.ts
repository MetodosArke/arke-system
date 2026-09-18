import type { LeituraCredencial } from "../types";

/**
 * Contrato que todo driver de catraca precisa implementar. Cada
 * fabricante (Control iD, Henry, Topdata, Dimep...) tem um protocolo TCP
 * proprietário e binário diferente — este pacote não inventa/adivinha os
 * bytes desses protocolos (ver o aviso em cada arquivo *Driver.ts em
 * drivers/). O que é comum e estável é este contrato: conectar, emitir
 * eventos de leitura de credencial, e comandar liberação/bloqueio com
 * feedback no display/sinal sonoro do equipamento.
 */
export interface CatracaDriver {
  readonly modelo: string;

  conectar(): Promise<void>;
  desconectar(): Promise<void>;

  /** Chamado a cada credencial lida (CPF digitado, cartão, biometria, QR). */
  aoLerCredencial(callback: (leitura: LeituraCredencial) => void): void;

  /** Destrava o giro e mostra o nome do aluno no display. */
  liberarAcesso(nomeAluno: string): Promise<void>;

  /** Mantém o giro travado, aciona o sinal sonoro e mostra o motivo. */
  negarAcesso(motivo: string): Promise<void>;
}
