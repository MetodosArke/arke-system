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
  modelo_catraca: z.enum(["controlid", "henry", "topdata", "topdata_facial", "toletus", "intelbras", "dimep", "mock"]),
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
  // Topdata: qual leitor físico é a entrada. Decisão de instalação — depende
  // de como a catraca foi montada, e só a bancada confirma.
  topdata_leitor_entrada: z.union([z.literal(1), z.literal(2)]).default(1),
  // Equipamentos Control iD que o Gateway administra pela API deles. O login
  // é o do próprio equipamento (menu do aparelho), não credencial do ARKE, e
  // fica só neste arquivo, na máquina da academia — nunca sobe para a nuvem.
  controlid_equipamentos: z
    .array(
      z.object({
        nome: z.string().min(1, "cada equipamento precisa de um nome"),
        ip: z.string().min(1, "ip do equipamento é obrigatório"),
        porta: z.number().int().positive().default(80),
        usuario: z.string().min(1).default("admin"),
        senha: z.string().min(1, "senha do equipamento é obrigatória"),
        sentido_entrada: z.enum(["clockwise", "anticlockwise"]).default("clockwise"),
        // Só os equipamentos com reconhecimento facial cadastram rosto.
        rosto: z.boolean().default(false),
        // Como libera: catraca (iDBlock), relé (iDAccess, iDFit, iDBox, e o
        // leitor numa catraca de outra marca) ou SecBox (iDFlex, iDAccess Pro
        // e Nano). O equipamento é reconhecido pelo IP, então o IP tem de ser fixo.
        liberacao: z.enum(["catraca", "rele", "secbox"]).default("catraca"),
        rele: z.union([z.literal(1), z.literal(2)]).default(1),
      })
    )
    .default([])
    .refine((l) => new Set(l.map((e) => e.nome)).size === l.length, "nomes de equipamento repetidos"),
  // IPs de equipamento que não estão em lista nenhuma (a Control iD única,
  // sem gestão remota). Com qualquer lista, o receptor só atende esses IPs.
  equipamentos_permitidos: z.array(z.string().trim().min(1)).default([]),
  // O equipamento Control iD que não está na lista acima (um só, sem gestão
  // remota) libera assim.
  controlid_liberacao: z.enum(["catraca", "rele", "secbox"]).default("catraca"),
  controlid_sentido_entrada: z.enum(["clockwise", "anticlockwise"]).default("clockwise"),
  controlid_rele: z.union([z.literal(1), z.literal(2)]).default(1),
  // Placas Toletus LiteNet2: aqui quem disca é o Gateway, para a porta 7878
  // de cada placa. Sem a lista, vale uma placa só, em catraca_ip.
  toletus_equipamentos: z
    .array(
      z.object({
        nome: z.string().min(1, "cada equipamento precisa de um nome"),
        ip: z.string().min(1, "ip do equipamento é obrigatório"),
        porta: z.number().int().positive().default(7878),
        liberar: z.enum(["entrada", "ambos"]).default("entrada"),
        placa: z.enum(["litenet2", "litenet3"]).default("litenet2"),
        serial: z.string().trim().min(1).optional(),
        // O leitor SM25 da LiteNet2, na porta 7879 do mesmo IP.
        leitor_digital: z.boolean().default(false),
        porta_leitor: z.number().int().positive().default(7879),
      })
    )
    .default([])
    .refine((l) => new Set(l.map((e) => e.nome)).size === l.length, "nomes de equipamento repetidos")
    .refine(
      (l) => l.every((e) => !(e.leitor_digital && e.placa === "litenet3")),
      "leitor_digital vale só na LiteNet2 (a LiteNet3 com digital manda a imagem do dedo, que o ARKE não compara)"
    )
    .refine(
      (l) => {
        const seriais = l.filter((e) => e.serial).map((e) => e.serial);
        return new Set(seriais).size === seriais.length;
      },
      "seriais de placa repetidos"
    ),
  // Leitores faciais da Topdata. A senha é a do menu do leitor (API HTTP):
  // como a da Control iD, fica só neste arquivo e nunca sobe para a nuvem.
  topdata_faciais: z
    .array(
      z.object({
        nome: z.string().min(1, "cada leitor precisa de um nome"),
        ip: z.string().min(1, "ip do leitor é obrigatório"),
        sn: z.string().trim().min(1).optional(),
        senha: z.string().min(1).optional(),
        porta_http: z.number().int().positive().default(80),
      })
    )
    .default([])
    .refine((l) => new Set(l.map((e) => e.nome)).size === l.length, "nomes de leitor repetidos")
    .refine(
      (l) => {
        const sns = l.filter((e) => e.sn).map((e) => e.sn);
        return new Set(sns).size === sns.length;
      },
      "números de série de leitor repetidos"
    ),
  // A porta padrão do menu do leitor (Configurações → Rede → Servidor).
  topdata_facial_porta: z.number().int().positive().default(7792),
  toletus_placa: z.enum(["litenet2", "litenet3"]).default("litenet2"),
  toletus_leitor_digital: z.boolean().default(false),
  // A LiteNet3 disca para o Gateway. 7880, e não a 7878 da placa nem a 7879
  // do leitor SM25, para não confundir quem lê a configuração do firewall.
  toletus_litenet3_porta: z.number().int().positive().default(7880),
  toletus_litenet3_endereco: z.string().trim().min(1).optional(),
  // Terminais Intelbras (linha Bio-T) no Modo Online. O login é o do próprio
  // terminal e fica só neste arquivo, como o da Control iD. O terminal é
  // reconhecido pelo IP, então o IP tem de ser fixo.
  intelbras_equipamentos: z
    .array(
      z.object({
        nome: z.string().min(1, "cada terminal precisa de um nome"),
        ip: z.string().min(1, "ip do terminal é obrigatório"),
        porta: z.number().int().positive().default(80),
        usuario: z.string().min(1).default("admin"),
        senha: z.string().min(1, "senha do terminal é obrigatória"),
        canal: z.number().int().positive().default(1),
        // A maior parte da linha é facial; os BIO (SS 3430, SS 5430) não são.
        rosto: z.boolean().default(true),
      })
    )
    .default([])
    .refine((l) => new Set(l.map((e) => e.nome)).size === l.length, "nomes de terminal repetidos")
    .refine((l) => new Set(l.map((e) => e.ip)).size === l.length, "dois terminais com o mesmo IP"),
  intelbras_endereco: z.string().trim().min(1).optional(),
  intelbras_configurar: z.boolean().default(true),
});

/**
 * As placas Toletus da academia. A academia com uma catraca só não precisa
 * da lista: o IP de sempre (catraca_ip) basta, com o tipo de toletus_placa.
 * catraca_porta não entra: nos outros modelos ela é outra coisa, e um
 * valor herdado de config antigo faria o Gateway discar para a porta errada.
 */
export function equipamentosToletus(config: GatewayConfig): NonNullable<GatewayConfig["toletus_equipamentos"]> {
  if (config.toletus_equipamentos?.length) return config.toletus_equipamentos;
  const placa = config.toletus_placa ?? "litenet2";
  return [
    {
      nome: "Catraca",
      ip: config.catraca_ip,
      porta: 7878,
      liberar: "entrada",
      placa,
      leitor_digital: placa === "litenet2" && !!config.toletus_leitor_digital,
      porta_leitor: 7879,
    },
  ];
}

/**
 * Os leitores faciais da Topdata. Na linha Easy com uma catraca só, o IP de
 * sempre (catraca_ip) basta. No modelo "topdata" (ponte), só os da lista:
 * catraca Inner sem leitor facial não tem o que cadastrar.
 */
export function leitoresFaciais(config: GatewayConfig): NonNullable<GatewayConfig["topdata_faciais"]> {
  if (config.topdata_faciais?.length) return config.topdata_faciais;
  if (config.modelo_catraca === "topdata_facial") return [{ nome: "Catraca", ip: config.catraca_ip, porta_http: 80 }];
  return [];
}

/**
 * Marcas sem integração ainda. Henry e Dimep não publicam documentação de
 * integração, e não há equipamento para bancada: a conexão é feita na
 * implantação do primeiro cliente com cada marca (decisão de 23/09/2026).
 * Até lá o Gateway se recusa a subir com elas — subir "quase funcionando",
 * com um driver que lança erro a cada leitura, deixaria a academia achando
 * que a catraca está integrada.
 */
const MODELOS_SEM_INTEGRACAO: Record<string, string> = {
  henry: "Henry",
  dimep: "Dimep",
};

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

  const marca = MODELOS_SEM_INTEGRACAO[resultado.data.modelo_catraca];
  if (marca) {
    throw new ConfigError(
      `A integração com catracas ${marca} ainda não está disponível no Gateway Local: ela é feita na ` +
        `implantação do primeiro cliente com essa marca, junto com a ArkeFit. Fale com o suporte antes ` +
        `de instalar. Enquanto isso, a academia pode usar o check-in por QR Code do ARKE.`
    );
  }

  return resultado.data;
}
