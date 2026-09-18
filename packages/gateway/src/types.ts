export type ModeloCatraca = "controlid" | "henry" | "topdata" | "dimep" | "mock";

export interface GatewayConfig {
  organization_id: string;
  /**
   * Na prática, este é o `device_token` cadastrado para o dispositivo em
   * /admin/catracas (o painel web já tem um botão "Copiar" para ele). O
   * nome do campo segue o pedido original ("token_api_local"), mas é o
   * mesmo valor usado pela Edge Function catraca-validar-acesso para
   * autenticar e identificar a organização — não é preciso enviar
   * organization_id separadamente nas chamadas à nuvem.
   */
  token_api_local: string;
  supabase_url: string;
  catraca_ip: string;
  catraca_porta: number;
  modelo_catraca: ModeloCatraca;
  tempo_timeout_ms: number;
  sincronizar_alunos_intervalo_ms: number;
}

/** Status operacional exibido no ícone da bandeja do sistema. */
export type StatusGateway = "online" | "contingencia" | "offline";

/** Um evento de leitura de credencial vindo da catraca física. */
export interface LeituraCredencial {
  tipo: "cpf" | "codigo_barras" | "rfid" | "biometria" | "qrcode";
  valor: string;
  lidoEm: Date;
}

/** Resultado — já traduzido para o vocabulário do gateway — de uma validação de acesso. */
export interface ResultadoValidacao {
  liberado: boolean;
  mensagem: string;
  nomeAluno?: string;
  alunoId?: string | null;
  /** true quando a decisão veio do cache local (SQLite/NeDB), não da nuvem. */
  validadoOffline: boolean;
}

/** Contrato real da Edge Function catraca-validar-acesso (Supabase). */
export interface RespostaValidarAcessoCloud {
  liberado?: boolean;
  motivo?: string;
  aluno_nome?: string;
  error?: string;
}

export interface AlunoCache {
  aluno_id: string;
  cpf: string;
  nome: string;
  inadimplente: boolean;
}

export interface RespostaSincronizarAlunosCloud {
  alunos?: AlunoCache[];
  sincronizado_em?: string;
  error?: string;
}

export type ResultadoLog =
  | "liberado"
  | "negado_inadimplente"
  | "negado_nao_encontrado"
  | "negado_catraca_inativa";

export interface LogAcessoPendente {
  aluno_id: string | null;
  cpf_consultado: string;
  resultado: ResultadoLog;
  ocorrido_em: string; // ISO
  sincronizado: boolean;
}
