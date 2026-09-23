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
  /**
   * Interface onde o gateway ESCUTA o equipamento. Control iD e Topdata
   * discam para fora: quem abre a conexão é a catraca, não nós. Por isso
   * o padrão é 0.0.0.0 — 127.0.0.1 deixaria o aparelho sem conseguir
   * alcançar o gateway pela rede da academia.
   */
  escuta_host: string;
  escuta_porta: number;
  /**
   * Quando um acesso liberado vira presença.
   *
   * `decisao`: na hora da liberação. É o que dá para fazer com equipamento
   * que não informa o giro — o "liberado" é o melhor sinal disponível.
   *
   * `catra_event`: só quando a catraca confirma que o aluno passou. Exige o
   * Monitor da Control iD configurado para este gateway (exclusivo da
   * iDBlock). Sem isso, a desistência na frente da borboleta contaria como
   * presença — e presença alimenta constância, inércia e avanço de fase.
   */
  confirmacao_giro: ConfirmacaoGiro;
  /** Quanto esperar o catra_event antes de desistir dele. */
  timeout_giro_ms: number;
}

export type ConfirmacaoGiro = "decisao" | "catra_event";

/**
 * Desfecho físico de um acesso liberado. `sem_confirmacao` conta como
 * presença: a desistência chega como evento próprio, então a ausência de
 * evento é problema de Monitor, não do aluno.
 */
export type Giro = "confirmado" | "desistencia" | "sem_confirmacao";

/** Status operacional exibido no ícone da bandeja do sistema. */
export type StatusGateway = "online" | "contingencia" | "offline";

/** Um evento de leitura de credencial vindo da catraca física. */
export interface LeituraCredencial {
  tipo: "cpf" | "codigo_barras" | "rfid" | "biometria" | "qrcode";
  valor: string;
  lidoEm: Date;
}

/**
 * Como o aluno chega identificado até a nuvem.
 *
 * `cpf` é o caminho de quem digita o documento no teclado da catraca.
 * `identificador_catraca` é o caminho da biometria: a digital é comparada
 * DENTRO do equipamento (1:N local, em milissegundos) e o que sai de lá não
 * é a digital nem o CPF — é o número do usuário no próprio aparelho. Esse
 * número vive em `alunos.identificador_catraca`, gravado no cadastro da
 * biometria.
 *
 * Nenhum dado biométrico trafega para decidir acesso, e isso não é só
 * privacidade: mandar template pela rede a cada giro não fecha no tempo de
 * uma catraca em horário de pico.
 */
export type Credencial =
  | { tipo: "cpf"; valor: string }
  | { tipo: "identificador_catraca"; valor: string };

/** Resultado — já traduzido para o vocabulário do gateway — de uma validação de acesso. */
export interface ResultadoValidacao {
  liberado: boolean;
  mensagem: string;
  nomeAluno?: string;
  alunoId?: string | null;
  /** true quando a decisão veio do cache local (SQLite/NeDB), não da nuvem. */
  validadoOffline: boolean;
  /** Registro criado pela nuvem, para confirmar o giro depois. Só no caminho online. */
  logId?: string;
}

/** Contrato real da Edge Function catraca-validar-acesso (Supabase). */
export interface RespostaValidarAcessoCloud {
  liberado?: boolean;
  motivo?: string;
  aluno_nome?: string;
  log_id?: string;
  error?: string;
}

export interface AlunoCache {
  aluno_id: string;
  cpf: string;
  nome: string;
  inadimplente: boolean;
  /** Número do usuário dentro do equipamento; ausente para quem não tem biometria cadastrada. */
  identificador_catraca?: string | null;
}

export interface RespostaSincronizarAlunosCloud {
  alunos?: AlunoCache[];
  sincronizado_em?: string;
  /**
   * false: `alunos` é só a diferença desde a última sincronização, e
   * `remover` traz quem sai do cache. Ausente (nuvem antiga) conta como
   * lista inteira — é o comportamento de antes.
   */
  completo?: boolean;
  remover?: string[];
  /** Hash do conjunto que o cache deve ter depois de aplicar a resposta. */
  ids_hash?: string;
  error?: string;
}

export type ResultadoLog =
  | "liberado"
  | "negado_inadimplente"
  | "negado_pausado"
  | "negado_nao_encontrado"
  | "negado_catraca_inativa";

export interface LogAcessoPendente {
  aluno_id: string | null;
  cpf_consultado: string;
  resultado: ResultadoLog;
  ocorrido_em: string; // ISO
  sincronizado: boolean;
  /** Desfecho do giro; "pendente" enquanto a catraca não confirmou. */
  giro?: Giro | "pendente";
}
