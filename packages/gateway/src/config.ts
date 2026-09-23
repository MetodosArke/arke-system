import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GatewayConfig } from "./types";

const configSchema = z.object({
  organization_id: z.string().uuid("organization_id deve ser um UUID válido"),
  token_api_local: z.string().min(10, "token_api_local (device_token da catraca) é obrigatório"),
  supabase_url: z.string().url("supabase_url deve ser uma URL válida"),
  catraca_ip: z.string().min(1, "catraca_ip é obrigatório"),
  catraca_porta: z.number().int().positive(),
  modelo_catraca: z.enum(["controlid", "henry", "topdata", "dimep", "mock"]),
  // 1000 ms, e não os 300 que o código prometia sem nunca ter medido. Medido
  // em 23/09/2026 contra catraca-validar-acesso em sa-east-1: mediana 405 ms,
  // p90 437 ms, 0 de 12 chamadas abaixo de 300 ms (só a ida e volta de rede
  // custa ~150 ms), e 4 s na partida a frio. Com 300 ms o gateway caía em
  // contingência em praticamente todo acesso — funcionava pelo cache, mas o
  // caminho online nunca era usado e o cache pode ter até 5 min de atraso.
  // Com 1000 ms a chamada normal passa com folga, e a partida a frio continua
  // caindo no cache, que é o certo: ninguém espera 4 s na frente da catraca.
  tempo_timeout_ms: z.number().int().positive().default(1000),
  sincronizar_alunos_intervalo_ms: z.number().int().positive().default(300_000),
  // Onde o gateway escuta o equipamento. Ver comentário em types.ts: a
  // catraca é quem disca, então isto precisa ser alcançável na LAN.
  escuta_host: z.string().min(1).default("0.0.0.0"),
  escuta_porta: z.number().int().positive().default(4571),
  // "decisao" é o padrão porque vale para qualquer equipamento; "catra_event"
  // só funciona com o Monitor da iDBlock configurado. Ver types.ts.
  confirmacao_giro: z.enum(["decisao", "catra_event"]).default("decisao"),
  timeout_giro_ms: z.number().int().positive().default(30_000),
});

export class ConfigError extends Error {}

/**
 * Carrega e valida config.json. Por padrão procura o arquivo ao lado do
 * executável (mesmo diretório do processo, importante para o .exe
 * empacotado com pkg, onde `__dirname` aponta para dentro do binário e
 * não é gravável) — pode ser sobrescrito via variável de ambiente
 * GATEWAY_CONFIG_PATH (usado pelos testes).
 */
export function carregarConfig(caminho?: string): GatewayConfig {
  const configPath = caminho ?? process.env.GATEWAY_CONFIG_PATH ?? path.join(process.cwd(), "config.json");

  if (!fs.existsSync(configPath)) {
    throw new ConfigError(
      `Arquivo de configuração não encontrado em "${configPath}". Copie config.example.json para ` +
        `config.json e preencha os dados da sua academia antes de iniciar o gateway.`
    );
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new ConfigError(`config.json inválido (JSON malformado): ${(error as Error).message}`);
  }

  const resultado = configSchema.safeParse(bruto);
  if (!resultado.success) {
    const detalhes = resultado.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new ConfigError(`config.json inválido:\n${detalhes}`);
  }

  return resultado.data;
}
