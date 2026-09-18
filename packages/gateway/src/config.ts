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
  tempo_timeout_ms: z.number().int().positive().default(300),
  sincronizar_alunos_intervalo_ms: z.number().int().positive().default(300_000),
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
