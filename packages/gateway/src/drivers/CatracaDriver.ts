import type { LeituraCredencial } from "../types";

/**
 * Contrato que todo driver de catraca precisa implementar: conectar, emitir
 * eventos de leitura de credencial, e comandar liberação/bloqueio com
 * feedback no display/sinal sonoro do equipamento.
 *
 * Control iD e Topdata não usam este caminho de verdade: nelas quem disca é
 * o equipamento (ou a ponte), e a decisão volta na resposta da mesma
 * requisição — ver `ReceptorDriver` e `src/receptores/`. Henry e Dimep não
 * têm driver: sem documentação de integração nem equipamento para bancada,
 * a conexão é feita na implantação do primeiro cliente de cada marca, e o
 * Gateway se recusa a subir com elas (ver config.ts).
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
