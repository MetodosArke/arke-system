/**
 * `topdata` é a linha Inner, pela ponte .NET. `topdata_facial` é a linha
 * Easy, em que o leitor facial decide com a nossa resposta, sem placa Inner.
 */
export type ModeloCatraca = "controlid" | "henry" | "topdata" | "topdata_facial" | "toletus" | "intelbras" | "dimep" | "mock";

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
  /** Topdata: qual leitor físico é a entrada (1 ou 2). */
  topdata_leitor_entrada?: 1 | 2;
  /**
   * Equipamentos Control iD que o Gateway administra pela API deles
   * (cadastro do aluno, da digital e do cartão, remoção, liberação remota).
   * Vazio: o Gateway só recebe as leituras, e o cadastro no equipamento
   * continua manual — como até a versão 1.0.
   */
  controlid_equipamentos?: EquipamentoControlId[];
  /**
   * Como libera o equipamento Control iD que não está em
   * `controlid_equipamentos` (academia com um equipamento só, sem gestão
   * remota): catraca da Control iD, relé ou SecBox. Ver `liberacao` no
   * equipamento.
   */
  controlid_liberacao?: "catraca" | "rele" | "secbox";
  /** Sentido de entrada da catraca Control iD fora de `controlid_equipamentos`. */
  controlid_sentido_entrada?: "clockwise" | "anticlockwise";
  /** Relé que libera, no leitor fora de `controlid_equipamentos` que libera pelo relé. */
  controlid_rele?: 1 | 2;
  /**
   * Placas Toletus a que o Gateway se conecta. Na LiteNet2 quem disca é o
   * Gateway (a placa escuta na porta 7878); na LiteNet3 é a placa, depois
   * de o Gateway anunciar o endereço por UDP. Vazio com o modelo "toletus":
   * vale uma placa só, em catraca_ip, do tipo de toletus_placa.
   */
  toletus_equipamentos?: EquipamentoToletus[];
  /**
   * Leitores faciais da Topdata. Com o modelo "topdata_facial" (linha
   * Easy), eles decidem o acesso com a resposta do Gateway. Com o modelo
   * "topdata" (Fit 4 Facial), quem decide continua sendo a placa Inner, pela
   * ponte; os leitores só guardam o cadastro dos alunos, que o Gateway
   * mantém. Quem disca é o leitor, para topdata_facial_porta.
   */
  topdata_faciais?: EquipamentoFacialTopdata[];
  topdata_facial_porta?: number;
  /** Tipo da placa quando a lista está vazia. */
  toletus_placa?: "litenet2" | "litenet3";
  /** Porta onde as placas LiteNet3 discam. */
  toletus_litenet3_porta?: number;
  /**
   * Endereço deste computador que as placas LiteNet3 devem discar. Vazio:
   * o Gateway descobre sozinho a interface que alcança cada placa. Só é
   * preciso em computador com várias redes em que a escolha automática erra.
   */
  toletus_litenet3_endereco?: string;
  /**
   * Terminais Intelbras (linha Bio-T) no Modo Online: o terminal pergunta
   * ao Gateway a cada acesso. Com a lista, o Gateway configura cada um ao
   * subir, cadastra e apaga o aluno, abre a porta a pedido da recepção e
   * desativa no terminal quem a academia barrou. Sem a lista, o Gateway só
   * recebe as tentativas.
   */
  intelbras_equipamentos?: EquipamentoIntelbras[];
  /**
   * Endereço deste computador que os terminais devem chamar. Vazio: o
   * Gateway descobre sozinho a interface que alcança cada terminal.
   */
  intelbras_endereco?: string;
  /** O Gateway configura o Modo Online em cada terminal ao subir (padrão: sim). */
  intelbras_configurar?: boolean;
}

export interface EquipamentoIntelbras {
  /** Como a recepção reconhece o terminal ("Catraca da entrada"). */
  nome: string;
  ip: string;
  porta: number;
  usuario: string;
  senha: string;
  /** O relé que libera a passagem (o `channel` da API). */
  canal: number;
  /** Terminal com reconhecimento facial: só nesses a ficha cadastra o rosto. */
  rosto: boolean;
}

export interface EquipamentoFacialTopdata {
  /** Como a recepção reconhece o leitor ("Catraca da entrada"). */
  nome: string;
  /** IP do leitor: identifica quem não tem `sn` no config e é usado pela API HTTP. */
  ip: string;
  /** Número de série, se o instalador anotou. É o que identifica o leitor. */
  sn?: string;
  /**
   * Senha de gerenciamento do menu do leitor, para a API HTTP (abertura
   * remota, fotos desligadas). Fica só no config.json, na máquina da
   * academia, e nunca sobe para a nuvem.
   */
  senha?: string;
  porta_http?: number;
}

export interface EquipamentoToletus {
  /** Como a recepção reconhece a catraca ("Catraca da entrada"). */
  nome: string;
  ip: string;
  /** Só na LiteNet2: a porta onde a placa escuta. */
  porta: number;
  /** LiteNet2 (o padrão) ou LiteNet3: protocolos diferentes, mesma decisão. */
  placa?: "litenet2" | "litenet3";
  /** LiteNet3: o serial da placa. Sem ele, o Gateway descobre pelo IP. */
  serial?: string;
  /**
   * O que liberar quando o aluno é aceito. "entrada" é o comum em
   * academia: a saída fica livre na configuração da placa. "ambos" serve
   * para catraca em que a saída também exige identificação.
   */
  liberar: "entrada" | "ambos";
}

export interface EquipamentoControlId {
  /** Como a recepção reconhece o equipamento ("Catraca da entrada"). */
  nome: string;
  ip: string;
  porta: number;
  usuario: string;
  senha: string;
  /** Sentido da borboleta que é a entrada — depende da montagem física. */
  sentido_entrada: "clockwise" | "anticlockwise";
  /**
   * Equipamento com reconhecimento facial (iDFace, iDFace Max, leitor
   * facial em catraca). Só nesses a ficha cadastra o rosto.
   */
  rosto?: boolean;
  /**
   * Como ele libera a passagem: "catraca" (iDBlock e iDBlock Next), "rele"
   * (iDAccess, iDFit, iDBox, e o leitor que libera a catraca de outra marca
   * pelo contato seco) ou "secbox" (iDFlex, iDAccess Pro, iDAccess Nano).
   * O iDFace usa relé ou SecBox, conforme a instalação.
   */
  liberacao?: "catraca" | "rele" | "secbox";
  /** Qual relé fecha, quando libera pelo relé. */
  rele?: 1 | 2;
}

/** Ordens que a nuvem manda ao Gateway (ver catraca-comandos). */
export type TipoComando =
  | "sincronizar_completo"
  | "enviar_logs"
  | "diagnostico"
  | "liberar_catraca"
  | "cadastrar_usuario"
  | "cadastrar_digital"
  | "cadastrar_cartao"
  /** A câmera do equipamento captura o rosto, com o aluno na frente. */
  | "cadastrar_rosto"
  /** A foto que o aluno mandou pelo app vai para os leitores faciais. */
  | "enviar_foto_rosto"
  | "apagar_usuario";

export interface ComandoGateway {
  id: string;
  tipo: TipoComando | string;
  parametros: Record<string, unknown>;
}

export interface ResultadoComando {
  id: string;
  sucesso: boolean;
  resultado?: Record<string, unknown>;
  erro?: string;
}

/** O que o Gateway conta à nuvem sobre si a cada chamada do canal. */
export interface TelemetriaGateway {
  versao: string;
  modelo: string;
  estado: StatusGateway;
  fila_offline: number;
  cache_alunos: number;
  ultima_sincronizacao: string | null;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
  /** `rosto`: o equipamento de gestão cadastra rosto (a ficha só oferece esses para o rosto). */
  equipamentos: { nome: string; tipo: string; visto_em: string | null; detalhe?: string; rosto?: boolean }[];
  ponte: { inners: number[]; conectados: number[]; vista_em: string } | null;
  capacidades: TipoComando[];
}

export interface RespostaComandosCloud {
  comandos?: ComandoGateway[];
  servidor_em?: string;
  error?: string;
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
