import type { GatewayConfig } from "../types";
import type { CatracaDriver } from "./CatracaDriver";
import { MockDriver } from "./MockDriver";
import { ReceptorDriver } from "./ReceptorDriver";
import { HenryDriver } from "./HenryDriver";
import { DimepDriver } from "./DimepDriver";

export type { CatracaDriver } from "./CatracaDriver";

export function criarDriver(config: Pick<GatewayConfig, "modelo_catraca" | "catraca_ip" | "catraca_porta">): CatracaDriver {
  switch (config.modelo_catraca) {
    case "mock":
      return new MockDriver();
    // Control iD fala HTTP e é ela quem disca para o gateway — ver
    // src/receptores/controlid.ts. O antigo ControlIdDriver assumia socket
    // TCP de saída, modelo errado segundo a documentação do fabricante, e
    // foi removido em vez de mantido como stub que nunca funcionaria.
    case "controlid":
      return new ReceptorDriver("controlid");

    // Topdata também é modelo de escuta, com uma camada a mais: quem fala
    // com a catraca é a ponte .NET que possui a EasyInner.dll, porque a
    // DLL é 32 bits, bloqueante e não thread-safe — incompatível com o
    // event loop do Node. Ver src/receptores/topdata.ts.
    case "topdata":
      return new ReceptorDriver("topdata");
    case "henry":
      return new HenryDriver(config.catraca_ip, config.catraca_porta);
    case "dimep":
      return new DimepDriver(config.catraca_ip, config.catraca_porta);
    default: {
      const _exaustivo: never = config.modelo_catraca;
      throw new Error(`Modelo de catraca desconhecido: ${_exaustivo}`);
    }
  }
}
