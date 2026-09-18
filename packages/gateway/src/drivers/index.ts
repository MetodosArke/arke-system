import type { GatewayConfig } from "../types";
import type { CatracaDriver } from "./CatracaDriver";
import { MockDriver } from "./MockDriver";
import { ControlIdDriver } from "./ControlIdDriver";
import { HenryDriver } from "./HenryDriver";
import { TopdataDriver } from "./TopdataDriver";
import { DimepDriver } from "./DimepDriver";

export type { CatracaDriver } from "./CatracaDriver";

export function criarDriver(config: Pick<GatewayConfig, "modelo_catraca" | "catraca_ip" | "catraca_porta">): CatracaDriver {
  switch (config.modelo_catraca) {
    case "mock":
      return new MockDriver();
    case "controlid":
      return new ControlIdDriver(config.catraca_ip, config.catraca_porta);
    case "henry":
      return new HenryDriver(config.catraca_ip, config.catraca_porta);
    case "topdata":
      return new TopdataDriver(config.catraca_ip, config.catraca_porta);
    case "dimep":
      return new DimepDriver(config.catraca_ip, config.catraca_porta);
    default: {
      const _exaustivo: never = config.modelo_catraca;
      throw new Error(`Modelo de catraca desconhecido: ${_exaustivo}`);
    }
  }
}
