import fs from "node:fs";
import path from "node:path";
import SysTray from "systray2";
import type { GatewayService } from "../core/gatewayService";
import type { StatusGateway } from "../types";
import { logger } from "../logger";

const ICONES: Record<StatusGateway, string> = {
  online: "online.png",
  contingencia: "contingencia.png",
  offline: "offline.png",
};

const TITULOS: Record<StatusGateway, string> = {
  online: "ArkeFit Gateway — Online",
  contingencia: "ArkeFit Gateway — Contingência (cache local)",
  offline: "ArkeFit Gateway — Desconectado",
};

function lerIconeBase64(nomeArquivo: string): string {
  const caminho = path.join(__dirname, "..", "..", "assets", "icons", nomeArquivo);
  return fs.readFileSync(caminho).toString("base64");
}

/**
 * Ícone na bandeja do Windows: verde (online), amarelo (contingência —
 * validando pelo cache local) ou vermelho (desconectado, sem cache). O
 * ícone é trocado automaticamente a cada mudança de status emitida pelo
 * GatewayService.
 */
export function criarSystray(gateway: GatewayService) {
  let status: StatusGateway = gateway.getStatus();

  const systray = new SysTray({
    menu: {
      icon: lerIconeBase64(ICONES[status]),
      title: "ArkeFit Gateway",
      tooltip: TITULOS[status],
      items: [
        { title: TITULOS[status], tooltip: "", checked: false, enabled: false },
        { title: "Sair", tooltip: "Encerrar o ArkeFit Gateway", checked: false, enabled: true },
      ],
    },
    debug: false,
    copyDir: true,
  });

  systray.onClick((action) => {
    if (action.seq_id === 1) {
      void systray.kill();
      process.exit(0);
    }
  });

  gateway.on("status", (novoStatus: StatusGateway) => {
    status = novoStatus;
    systray
      .sendAction({
        type: "update-menu",
        menu: {
          icon: lerIconeBase64(ICONES[status]),
          title: "ArkeFit Gateway",
          tooltip: TITULOS[status],
          items: [
            { title: TITULOS[status], tooltip: "", checked: false, enabled: false },
            { title: "Sair", tooltip: "Encerrar o ArkeFit Gateway", checked: false, enabled: true },
          ],
        },
      })
      .catch((err: Error) => logger.warn({ err: err.message }, "Falha ao atualizar o ícone da bandeja"));
  });

  return systray;
}
