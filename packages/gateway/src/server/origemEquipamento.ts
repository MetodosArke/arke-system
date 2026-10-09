import type { GatewayConfig } from "../types";
import { ipDoEquipamento } from "../receptores/controlid";

/**
 * Quem pode falar com o receptor.
 *
 * O receptor escuta na rede da academia, e a rede da academia não é de
 * confiança: o Wi-Fi dos alunos às vezes é a mesma rede das catracas. Sem
 * filtro, qualquer aparelho que soubesse a rota fingia ser a catraca: pedia
 * decisão por número de aluno (e criava presença para quem não veio),
 * fechava giro alheio pelo aviso do Monitor e mandava acesso "histórico" da
 * Intelbras, que vira presença na hora em que diz ter acontecido.
 *
 * A lista são os IPs dos equipamentos que o config já tem (Control iD,
 * Intelbras e Hikvision, reconhecidos pelo IP) mais `equipamentos_permitidos`, para o
 * equipamento que não está em lista nenhuma (a Control iD única, sem gestão
 * remota). A própria máquina sempre passa: é ela que roda o emulador na
 * instalação, e quem já está nela não precisa do receptor para nada.
 *
 * Sem lista nenhuma, o receptor continua aceitando qualquer aparelho, como
 * até a versão 1.6, e o Gateway avisa no log ao subir. Recusar ali pararia a
 * catraca de quem atualizou sem mexer no config.
 */
export function ipsPermitidos(
  config: Pick<GatewayConfig, "controlid_equipamentos" | "intelbras_equipamentos" | "hikvision_equipamentos" | "equipamentos_permitidos">
): Set<string> {
  const ips = [
    ...(config.controlid_equipamentos ?? []).map((e) => e.ip),
    ...(config.intelbras_equipamentos ?? []).map((e) => e.ip),
    ...(config.hikvision_equipamentos ?? []).map((e) => e.ip),
    ...(config.equipamentos_permitidos ?? []),
  ];
  return new Set(ips.map(ipDoEquipamento).filter((ip) => ip.length > 0));
}

const LOOPBACK = new Set(["127.0.0.1", "::1"]);

export function origemPermitida(permitidos: ReadonlySet<string>, ip: string | undefined): boolean {
  const origem = ipDoEquipamento(ip);
  if (LOOPBACK.has(origem)) return true;
  if (permitidos.size === 0) return true;
  return permitidos.has(origem);
}

/**
 * Rotas que não passam pelo filtro: a sonda de vida da porta (o técnico a
 * chama de outro computador na instalação, e ela só diz a versão) e as da
 * ponte Topdata, que já atendem só a própria máquina.
 */
export function rotaSemFiltro(url: string): boolean {
  const caminho = url.split("?")[0];
  return caminho === "/health" || caminho.startsWith("/topdata/");
}
