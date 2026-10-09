/**
 * Protocolo ISAPI dos aparelhos de controle de acesso da Hikvision: os
 * terminais faciais DS-K1T671 (séries Pro e Ultra) e DS-K1T341 (série Value)
 * e a controladora DS-K2604. Escrito a partir da documentação ISAPI da
 * Hikvision (portal de parceiros), lida em 08/10/2026.
 *
 * Duas direções, as duas por HTTP na rede da academia:
 *   - o Gateway administra o aparelho (pessoa, rosto, cartão, digital, porta,
 *     hora e configuração), com autenticação Digest;
 *   - o aparelho manda cada acesso ao receptor do Gateway (o servidor de
 *     escuta, `httpHosts`) e, com a verificação remota ligada, espera a
 *     decisão na resposta do mesmo POST.
 *
 * Este módulo é só tradução, sem rede.
 */

import { randomBytes } from "node:crypto";
import { mensagemDoDisplay } from "../../core/display";

export const PORTA_HTTP_HIKVISION = 80;

/** Onde o aparelho entrega os eventos: o caminho que o Gateway grava no servidor de escuta. */
export const CAMINHO_EVENTOS = "/hikvision/evento";

/** Evento de mais de 5 minutos atrás é registro guardado pelo aparelho, não pedido de agora. */
export const JANELA_TEMPO_REAL_MS = 5 * 60_000;

/** Quanto o aparelho espera a decisão, em segundos. Bem acima do segundo que o Gateway leva no pior caso. */
export const ESPERA_DA_DECISAO_S = 5;

/** A biblioteca de rostos de luz visível, a que o terminal usa para reconhecer. */
export const BIBLIOTECA_ROSTOS = { faceLibType: "blackFD", FDID: "1" } as const;

/** O ARKE guarda uma digital por aluno: é sempre o dedo 1 do aparelho. */
export const DEDO_DO_ALUNO = 1;

type Objeto = Record<string, unknown>;

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const booleano = (v: unknown): boolean | null => {
  if (v === true || v === false) return v;
  if (typeof v === "string" && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === "true";
  return null;
};

// ——— XML ———

/** O conteúdo de uma tag, sem prefixo de namespace nem comentários. null se não houver. */
export function tagDoXml(xml: string, nome: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nome}>`).exec(xml);
  return m ? m[1].replace(/<!--[\s\S]*?-->/g, "").trim() : null;
}

const escaparXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const NS = 'version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"';
const xml = (corpo: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${corpo}`;

// ——— O que o aparelho é e o que ele faz ———

export interface InfoHikvision {
  modelo: string | null;
  firmware: string | null;
  serie: string | null;
  tipo: string | null;
}

/** A resposta de `/ISAPI/System/deviceInfo`. */
export function lerInfoDoAparelho(corpo: string): InfoHikvision {
  return {
    modelo: tagDoXml(corpo, "model"),
    firmware: tagDoXml(corpo, "firmwareVersion"),
    serie: tagDoXml(corpo, "serialNumber"),
    tipo: tagDoXml(corpo, "deviceType"),
  };
}

/** A DS-K2604 e as irmãs (DS-K26xx) são controladoras: sem câmera, com leitores ligados a elas. */
export function ehControladora(info: InfoHikvision | null): boolean {
  return /^DS-K26/i.test(info?.modelo ?? "");
}

export interface CapacidadesHikvision {
  pessoa: boolean;
  cartao: boolean;
  rosto: boolean;
  digital: boolean;
  apagarDigital: boolean;
  capturaCartao: boolean;
  capturaRosto: boolean;
  capturaDigital: boolean;
  verificacaoRemota: boolean;
  configuracao: boolean;
  /** Apaga a pessoa com o cartão, a digital e o rosto dela numa chamada só. */
  apagarPessoa: boolean;
}

/**
 * As capacidades de controle de acesso (`/ISAPI/AccessControl/capabilities`),
 * em XML ou em JSON. O que o aparelho não declara conta como "não tem": é a
 * controladora sem terminal facial que não oferece rosto, por exemplo.
 */
export function lerCapacidades(corpo: string): CapacidadesHikvision {
  const sim = (nome: string) =>
    new RegExp(`<(?:[\\w-]+:)?isSupport${nome}(?:\\s[^>]*)?>\\s*true\\s*<`, "i").test(corpo) ||
    new RegExp(`"isSupport${nome}"\\s*:\\s*(true|"true")`, "i").test(corpo);
  return {
    pessoa: sim("UserInfo"),
    cartao: sim("CardInfo"),
    rosto: sim("FDLib"),
    digital: sim("FingerPrintCfg"),
    apagarDigital: sim("FingerPrintDelete"),
    capturaCartao: sim("CaptureCardInfo"),
    capturaRosto: sim("CaptureFace"),
    capturaDigital: sim("CaptureFingerPrint"),
    verificacaoRemota: sim("RemoteCheck"),
    configuracao: sim("AcsCfg"),
    apagarPessoa: sim("UserInfoDetailDelete"),
  };
}

// ——— Respostas e erros ———

export interface StatusIsapi {
  statusCode: number | null;
  subStatusCode: string | null;
  errorCode: number | null;
}

/** O `ResponseStatus` de uma resposta, em JSON ou XML. null se o corpo não tiver um. */
export function lerStatus(corpo: string): StatusIsapi | null {
  const t = corpo.trim();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as Objeto;
      if (!("statusCode" in j) && !("subStatusCode" in j)) return null;
      return { statusCode: numero(j.statusCode), subStatusCode: texto(j.subStatusCode), errorCode: numero(j.errorCode) };
    } catch {
      return null;
    }
  }
  if (!/<(?:[\w-]+:)?statusCode[\s>]/.test(t)) return null;
  return {
    statusCode: numero(tagDoXml(t, "statusCode")),
    subStatusCode: texto(tagDoXml(t, "subStatusCode")),
    errorCode: numero(tagDoXml(t, "errorCode")),
  };
}

export const statusOk = (s: StatusIsapi | null): boolean => !s || s.statusCode === null || s.statusCode === 1;

/**
 * Os erros que o Gateway encontra no caminho dele, numa frase para o log e
 * para a ficha. O código do aparelho vai junto, entre parênteses, para o
 * suporte achar na documentação; nada do aluno entra na frase.
 */
const ERROS: Record<string, string> = {
  notSupport: "o aparelho não tem esta função",
  lowPrivilege: "o usuário configurado no Gateway não tem permissão para isso no aparelho (use o administrador)",
  methodNotAllowed: "o aparelho não aceita este tipo de pedido",
  invalidOperation: "o aparelho recusou o comando",
  notActivated: "o aparelho ainda não foi ativado (defina a senha dele na tela ou pelo SADP)",
  deviceBusy: "o aparelho está ocupado; tente de novo em instantes",
  upgrading: "o aparelho está atualizando o firmware",
  noMemory: "o aparelho está sem memória livre",
  serviceUnavailable: "o serviço do aparelho não está disponível agora",
  badJsonFormat: "o aparelho não entendeu o pedido (formato inesperado para este firmware)",
  badXmlFormat: "o aparelho não entendeu o pedido (formato inesperado para este firmware)",
  badURLFormat: "o aparelho não entendeu o endereço do pedido",
  badParameters: "o aparelho recusou um campo do pedido (firmware diferente do esperado)",
  badXmlContent: "o aparelho recusou um campo do pedido (firmware diferente do esperado)",
  employeeNoNotExist: "o aluno não está cadastrado neste aparelho",
  deviceUserNotExist: "o aluno não está cadastrado neste aparelho",
  employeeNoAlreadyExist: "o aluno já está cadastrado neste aparelho",
  deviceUserAlreadyExist: "o aluno já está cadastrado neste aparelho",
  deviceUserFull: "o aparelho chegou ao limite de pessoas",
  illegalEmployeeNo: "o número do aluno não serve para este aparelho",
  cardNoAlreadyExist: "este cartão já está cadastrado para outra pessoa no aparelho",
  illegalCardNo: "o número do cartão não serve para este aparelho",
  deviceCardFull: "o aparelho chegou ao limite de cartões",
  cardFullPerUser: "o aluno já tem o máximo de cartões neste aparelho",
  supportOneMoreCard: "o aparelho aceita um cartão só por pessoa",
  fingerPrintAlreadyExist: "esta digital já está cadastrada no aparelho",
  fingerprintFull: "o aparelho chegou ao limite de digitais",
  fingerprintFullPerUser: "o aluno já tem o máximo de digitais neste aparelho",
  fingerPrintDataLenZero: "a digital veio vazia; peça para pôr o dedo de novo",
  fingerPrintLowQulity: "a digital saiu fraca; peça para pôr o dedo de novo, bem no centro do leitor",
  fingerPrintFeatureMergeFailed: "o aparelho não conseguiu montar a digital; peça para pôr o dedo de novo",
  errorFingerID: "o aparelho recusou o número do dedo",
  deviceFaceFull: "o aparelho chegou ao limite de rostos",
  deviceUserAlreadyExistFace: "o aluno já tem rosto neste aparelho",
  pictureFaceDetectZero: "nenhum rosto encontrado na foto",
  multipleFaceObjectError: "há mais de um rosto na foto",
  faceLowQulity: "a foto do rosto tem qualidade baixa",
  poorFaceQuality: "a foto do rosto tem qualidade baixa",
  faceResolutionOrRatioError: "a foto do rosto está fora do tamanho ou da proporção que o aparelho aceita",
  faceDataLenShort: "a foto do rosto é pequena demais",
  fileSizeExceedError: "a foto do rosto passa do tamanho que o aparelho aceita",
  picSizeExceedError: "a foto do rosto passa do tamanho que o aparelho aceita",
  pupilDistanceTooSmall: "o rosto está longe demais na foto",
  faceScoreFailure: "o aparelho não conseguiu avaliar o rosto da foto",
  faceTypeError: "o aparelho recusou a foto do rosto",
  alreadyExistThisFace: "este rosto já está cadastrado para outra pessoa",
  invalidFaceRegion: "o rosto está fora da área aceita na foto",
  remoteDoorFunctionDisable: "a abertura remota está desligada no aparelho",
  securityModuleOffline: "o módulo da porta está desconectado; a porta não abriu",
  cardReaderOffline: "o leitor está desconectado do aparelho",
  endtimeEarlierThanBegintime: "o aparelho recusou a validade do aluno",
  beyondTimeRangeLimit: "o aparelho recusou a hora enviada",
  deployExceedMax: "o aparelho chegou ao limite de destinos de eventos",
  rebootRequired: "a configuração vale depois de reiniciar o aparelho",
};

const GERAIS: Record<number, string> = {
  2: "o aparelho está ocupado; tente de novo em instantes",
  3: "o aparelho teve um erro interno",
  4: "o aparelho recusou a operação",
  5: "o aparelho não entendeu o formato do pedido",
  6: "o aparelho recusou o conteúdo do pedido",
  7: "a configuração vale depois de reiniciar o aparelho",
};

/** A frase de um erro do aparelho. */
export function mensagemDoErro(s: StatusIsapi | null, http?: number): string {
  const sub = s?.subStatusCode ?? null;
  const base = (sub && ERROS[sub]) || (s?.statusCode != null && GERAIS[s.statusCode]) || (http ? `o aparelho respondeu ${http}` : "o aparelho recusou o pedido");
  const codigo = sub && sub !== "ok" ? sub : s?.errorCode != null ? `0x${s.errorCode.toString(16)}` : null;
  return codigo ? `${base} (${codigo})` : base;
}

/** O aluno ou a credencial não existe no aparelho: para apagar, é o estado que se queria. */
export const ERROS_DE_INEXISTENTE = new Set([
  "employeeNoNotExist",
  "deviceUserNotExist",
  "deleteNoExistFace",
  "cardNoNotExist",
  "fingerPrintNotExist",
  "faceDataNotExist",
  "operObjectNotExist",
]);

/** O aparelho não tem aquela chamada: vale tentar a outra forma da mesma operação. */
export const ERROS_DE_FUNCAO = new Set(["notSupport", "methodNotAllowed", "invalidOperation", "badURLFormat"]);

// ——— Pessoa, cartão, digital e rosto ———

const VALIDO_DESDE = "2020-01-01T00:00:00";
const VALIDO_ATE = "2037-12-31T23:59:59";
/** Um dia que já passou: o aparelho recusa sozinho quem está fora da validade, também sem o Gateway. */
const VALIDO_ATE_BARRADO = "2020-01-01T23:59:59";

/**
 * O aluno no aparelho. O nome é "Aluno", e não o da pessoa: o terminal
 * mostra o nome na tela, e a tela é pública. O número é o da catraca do
 * aluno (`identificador_catraca`), nunca o CPF.
 *
 * Quem a academia barrou (pausado, inadimplente fora da tolerância) vai com a
 * validade vencida, para o caso de o aparelho ficar sem o Gateway: ele decide
 * com a lista que tem, e essa pessoa não entra.
 */
export function usuarioDoAluno(id: number | string, barrado = false, porta = 1): Objeto {
  return {
    UserInfo: {
      employeeNo: String(id),
      name: "Aluno",
      userType: "normal",
      Valid: { enable: true, beginTime: VALIDO_DESDE, endTime: barrado ? VALIDO_ATE_BARRADO : VALIDO_ATE, timeType: "local" },
      doorRight: String(porta),
      RightPlan: [{ doorNo: porta, planTemplateNo: "1" }],
    },
  };
}

/** O aluno, para apagar com tudo o que é dele (cartão, digital e rosto). */
export const apagarPessoaCompleta = (id: number | string) => ({
  UserInfoDetail: { mode: "byEmployeeNo", EmployeeNoList: [{ employeeNo: String(id) }] },
});

/** O aluno, para apagar pela chamada simples (aparelho sem a remoção completa). */
export const apagarPessoaSimples = (id: number | string) => ({
  UserInfoDelCond: { EmployeeNoList: [{ employeeNo: String(id) }] },
});

export const cartaoDoAluno = (id: number | string, cartao: string) => ({
  CardInfo: { employeeNo: String(id), cardNo: cartao, cardType: "normalCard" },
});

export const apagarCartoesDoAluno = (id: number | string) => ({
  CardInfoDelCond: { EmployeeNoList: [{ employeeNo: String(id) }] },
});

export const digitalDoAluno = (id: number | string, dados: string, leitores: number[]) => ({
  FingerPrintCfg: {
    employeeNo: String(id),
    enableCardReader: leitores,
    fingerPrintID: DEDO_DO_ALUNO,
    fingerType: "normalFP",
    fingerData: dados,
  },
});

export const apagarDigitalDoAluno = (id: number | string, leitores: number[]) => ({
  FingerPrintDelete: {
    mode: "byEmployeeNo",
    EmployeeNoDetail: { employeeNo: String(id), enableCardReader: leitores, fingerPrintID: [DEDO_DO_ALUNO] },
  },
});

/** O registro do rosto, ligado ao aluno pelo número: a foto vai na parte `img`. */
export const rostoDoAluno = (id: number | string) => ({ ...BIBLIOTECA_ROSTOS, FPID: String(id) });

export const apagarRostoDoAluno = (id: number | string) => ({ FPID: [{ value: String(id) }] });

/**
 * A situação de cada leitor depois de receber a digital. 1 é recebida; os
 * outros dizem o que houve com aquele leitor.
 */
export const SITUACAO_DA_DIGITAL: Record<number, string> = {
  0: "o aparelho não conseguiu falar com o leitor de digital",
  2: "o leitor de digital está desconectado",
  3: "a digital saiu fraca; peça para pôr o dedo de novo",
  4: "o leitor de digital está cheio",
  5: "esta digital já está cadastrada no aparelho",
  6: "o aluno já tem digital neste leitor",
  7: "o aparelho recusou o número do dedo",
  8: "o leitor de digital já estava configurado",
  10: "o firmware do leitor de digital é antigo demais",
};

export const caminhos = {
  infoDoAparelho: "/ISAPI/System/deviceInfo",
  capacidades: "/ISAPI/AccessControl/capabilities",
  hora: "/ISAPI/System/time",
  servidorDeEventos: "/ISAPI/Event/notification/httpHosts",
  configuracao: "/ISAPI/AccessControl/AcsCfg?format=json",
  aplicarUsuario: "/ISAPI/AccessControl/UserInfo/SetUp?format=json",
  incluirUsuario: "/ISAPI/AccessControl/UserInfo/Record?format=json",
  alterarUsuario: "/ISAPI/AccessControl/UserInfo/Modify?format=json",
  apagarUsuario: "/ISAPI/AccessControl/UserInfo/Delete?format=json",
  apagarPessoa: "/ISAPI/AccessControl/UserInfoDetail/Delete?format=json",
  progressoApagarPessoa: "/ISAPI/AccessControl/UserInfoDetail/DeleteProcess?format=json",
  incluirCartao: "/ISAPI/AccessControl/CardInfo/Record?format=json",
  apagarCartoes: "/ISAPI/AccessControl/CardInfo/Delete?format=json",
  capturarCartao: "/ISAPI/AccessControl/CaptureCardInfo?format=json",
  enviarDigital: "/ISAPI/AccessControl/FingerPrintDownload?format=json",
  progressoDigital: "/ISAPI/AccessControl/FingerPrintProgress?format=json",
  apagarDigital: "/ISAPI/AccessControl/FingerPrint/Delete?format=json",
  progressoApagarDigital: "/ISAPI/AccessControl/FingerPrint/DeleteProcess?format=json",
  capturarDigital: "/ISAPI/AccessControl/CaptureFingerPrint",
  aplicarRosto: "/ISAPI/Intelligent/FDLib/FDSetUp?format=json",
  incluirRosto: "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json",
  alterarRosto: "/ISAPI/Intelligent/FDLib/FDModify?format=json",
  apagarRosto: `/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=${BIBLIOTECA_ROSTOS.FDID}&faceLibType=${BIBLIOTECA_ROSTOS.faceLibType}`,
  capturarRosto: "/ISAPI/AccessControl/CaptureFaceData",
  progressoRosto: "/ISAPI/AccessControl/CaptureFaceData/Progress",
  abrirPorta: (porta: number) => `/ISAPI/AccessControl/RemoteControl/door/${porta}`,
};

// ——— Corpos em XML ———

/** A hora do aparelho, no fuso de Brasília ("aaaa-mm-ddThh:mm:ss"). */
export function horaDoAparelho(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(agora)
    .replace(" ", "T");
}

/**
 * Hora certa, no fuso de Brasília (UTC-3, sem horário de verão). O fuso vai
 * no formato do aparelho, que inverte o sinal (como o TZ do POSIX). A hora
 * importa: é por ela que o Gateway separa o pedido de agora do registro
 * guardado.
 */
export const xmlHora = (agora: Date = new Date()) =>
  xml(`<Time ${NS}><timeMode>manual</timeMode><localTime>${horaDoAparelho(agora)}</localTime><timeZone>CST+3:00:00</timeZone></Time>`);

/**
 * O servidor de escuta: o aparelho manda cada evento ao receptor do Gateway,
 * em JSON. Sem autenticação do lado do aparelho, como nas outras marcas: o
 * receptor só atende os IPs do config. O reenvio automático (`httpBroken`)
 * fica ligado: o que o aparelho decidiu sem o Gateway chega quando ele volta.
 */
export function xmlServidorDeEventos(endereco: string, porta: number): string {
  const ip = endereco.includes(":") ? `<ipv6Address>${escaparXml(endereco)}</ipv6Address>` : `<ipAddress>${escaparXml(endereco)}</ipAddress>`;
  return xml(
    `<HttpHostNotificationList ${NS}><HttpHostNotification>` +
      `<id>1</id><url>${CAMINHO_EVENTOS}</url><protocolType>HTTP</protocolType>` +
      `<parameterFormatType>JSON</parameterFormatType><addressingFormatType>ipaddress</addressingFormatType>` +
      `${ip}<portNo>${porta}</portNo><httpAuthenticationMethod>none</httpAuthenticationMethod>` +
      `<httpBroken>true</httpBroken>` +
      `</HttpHostNotification></HttpHostNotificationList>`
  );
}

export const xmlAbrirPorta = () => xml(`<RemoteControlDoor ${NS}><cmd>open</cmd></RemoteControlDoor>`);

export const xmlCapturarDigital = () =>
  xml(`<CaptureFingerPrintCond ${NS}><fingerNo>${DEDO_DO_ALUNO}</fingerNo></CaptureFingerPrintCond>`);

/** A foto capturada vem em binário na resposta, e não por endereço: assim ela não fica exposta no aparelho. */
export const xmlCapturarRosto = () =>
  xml(`<CaptureFaceDataCond ${NS}><captureInfrared>false</captureInfrared><dataType>binary</dataType></CaptureFaceDataCond>`);

// ——— Configuração de acesso ———

/** As fotos de cada acesso: o ARKE não precisa delas, e elas não saem nem ficam guardadas no aparelho. */
const FOTOS_DO_ACESSO = ["uploadVerificationPic", "saveVerificationPic", "uploadCapPic", "saveCapPic", "saveFacePic"];

/**
 * A configuração de acesso (`AcsCfg`) a partir da atual: só os campos que o
 * ARKE precisa mudam, o resto fica como o instalador deixou.
 *
 * VERIFICAÇÃO REMOTA. O aparelho reconhece a pessoa sozinho (rosto ou
 * cartão, `needDeviceCheck`) e pergunta ao Gateway, no mesmo POST do evento,
 * se ela entra (`ISAPIListen` com resposta `sync`). Sem o Gateway ele decide
 * com a lista que tem (`offlineDevCheckOpenDoorEnabled`): é para isso que o
 * aluno barrado vai com a validade vencida. A digital não está entre as
 * credenciais que a documentação deixa perguntar: ela é decidida no próprio
 * aparelho, pela mesma lista.
 */
export function configuracaoDeAcesso(atual: Objeto, o: { verificacaoRemota: boolean; comRosto: boolean }): Objeto {
  const novo: Objeto = { ...atual };
  if (o.verificacaoRemota) {
    Object.assign(novo, {
      remoteCheckDoorEnabled: true,
      checkChannelType: "ISAPIListen",
      needDeviceCheck: true,
      remoteCheckTimeout: ESPERA_DA_DECISAO_S,
      // 6: rosto ou cartão; 4: só cartão (a controladora sem terminal facial).
      remoteCheckVerifyMode: o.comRosto ? 6 : 4,
      offlineDevCheckOpenDoorEnabled: true,
      remoteCheckUserTypeList: ["normal", "visitor", "unregistered"],
      remoteCheckWithISAPIListen: "sync",
    });
  }
  for (const campo of FOTOS_DO_ACESSO) if (campo in atual) novo[campo] = false;
  return { AcsCfg: novo };
}

// ——— Multipart ———

export interface ParteEnvio {
  nome: string;
  tipo: string;
  dados: Buffer;
  arquivo?: string;
}

/** Um corpo `multipart/form-data`, como o aparelho pede para o rosto. */
export function montarMultipart(partes: ParteEnvio[], fronteira = `arke${randomBytes(12).toString("hex")}`): { corpo: Buffer; tipo: string } {
  const blocos: Buffer[] = [];
  for (const p of partes) {
    const disposicao = `form-data; name="${p.nome}"${p.arquivo ? `; filename="${p.arquivo}"` : ""}`;
    blocos.push(
      Buffer.from(`--${fronteira}\r\nContent-Disposition: ${disposicao}\r\nContent-Type: ${p.tipo}\r\nContent-Length: ${p.dados.length}\r\n\r\n`),
      p.dados,
      Buffer.from("\r\n")
    );
  }
  blocos.push(Buffer.from(`--${fronteira}--\r\n`));
  return { corpo: Buffer.concat(blocos), tipo: `multipart/form-data; boundary=${fronteira}` };
}

export interface ParteRecebida {
  nome: string | null;
  tipo: string | null;
  /** Os bytes da parte, sem cópia. Só vira texto quando é texto. */
  corpo: Buffer;
}

const TIPOS_DE_TEXTO = /^(application\/(json|xml)|text\/)/i;

/** As partes de um corpo multipart, ou null se ele não for multipart. Aceita CRLF e LF. */
export function partesDoMultipart(corpo: Buffer, contentType: string | null | undefined): ParteRecebida[] | null {
  const fronteira = /boundary="?([^";]+)"?/i.exec(contentType ?? "")?.[1]?.trim();
  if (!fronteira) return null;
  const marca = Buffer.from(`--${fronteira}`);
  let pos = corpo.indexOf(marca);
  if (pos < 0) return null;
  const partes: ParteRecebida[] = [];
  while (pos >= 0) {
    const inicio = pos + marca.length;
    if (corpo.subarray(inicio, inicio + 2).toString("latin1") === "--") break;
    const prox = corpo.indexOf(marca, inicio);
    const bloco = corpo.subarray(inicio, prox < 0 ? corpo.length : prox);
    pos = prox;
    let fimCab = bloco.indexOf("\r\n\r\n");
    let sep = 4;
    const fimLf = bloco.indexOf("\n\n");
    if (fimCab < 0 || (fimLf >= 0 && fimLf < fimCab)) {
      fimCab = fimLf;
      sep = 2;
    }
    if (fimCab < 0) continue;
    // Só os cabeçalhos viram texto aqui; o corpo de imagem nunca.
    const cabecalhos = bloco.subarray(0, fimCab).toString("latin1");
    const tamanho = numero(/content-length:\s*(\d+)/i.exec(cabecalhos)?.[1]);
    let dados = bloco.subarray(fimCab + sep, tamanho !== null ? fimCab + sep + tamanho : bloco.length);
    if (tamanho === null) {
      // Sem tamanho declarado, a quebra de linha antes da próxima fronteira não é do corpo.
      if (dados.subarray(-2).toString("latin1") === "\r\n") dados = dados.subarray(0, -2);
      else if (dados.subarray(-1).toString("latin1") === "\n") dados = dados.subarray(0, -1);
    }
    partes.push({
      nome: /name="?([^";\r\n]+)"?/i.exec(cabecalhos)?.[1] ?? null,
      tipo: /content-type:\s*([^;\r\n]+)/i.exec(cabecalhos)?.[1]?.trim() ?? null,
      corpo: dados,
    });
  }
  return partes;
}

/** A primeira parte de texto (JSON ou XML) de uma resposta multipart, ou o corpo inteiro se não for multipart. */
export function textoDaResposta(corpo: Buffer, contentType: string | null | undefined): string {
  const partes = partesDoMultipart(corpo, contentType);
  if (!partes) return corpo.toString("utf8");
  const t = partes.find((p) => TIPOS_DE_TEXTO.test(p.tipo ?? ""));
  return t ? t.corpo.toString("utf8") : "";
}

// ——— Eventos ———

/** Os campos de um evento de acesso em XML (firmware que mande assim), no mesmo formato do JSON. */
const CAMPOS_DO_EVENTO = [
  "majorEventType",
  "subEventType",
  "employeeNoString",
  "employeeNo",
  "cardNo",
  "cardReaderNo",
  "cardReaderKind",
  "doorNo",
  "serialNo",
  "currentEvent",
  "remoteCheck",
  "remoteCheckResult",
  "swipeCardType",
  "QRCodeInfo",
];

function eventoDoXml(corpo: string): Objeto | null {
  const tipo = tagDoXml(corpo, "eventType");
  if (!tipo) return null;
  const evento: Objeto = { eventType: tipo, dateTime: tagDoXml(corpo, "dateTime") };
  const bloco = tagDoXml(corpo, "AccessControllerEvent");
  if (bloco) {
    const dados: Objeto = {};
    for (const campo of CAMPOS_DO_EVENTO) {
      const v = tagDoXml(bloco, campo);
      if (v !== null) dados[campo] = v;
    }
    evento.AccessControllerEvent = dados;
  }
  return evento;
}

/**
 * Os eventos de um POST do aparelho: o JSON (ou XML) de cada parte de
 * texto. As partes de imagem (a foto de quem estava na frente do aparelho)
 * são ignoradas na leitura: não viram texto, não entram no evento, não vão
 * para log nem para a nuvem.
 */
export function eventosDoCorpo(corpo: Buffer, contentType: string | null | undefined): Objeto[] {
  const partes = partesDoMultipart(corpo, contentType);
  const textos = partes
    ? partes.filter((p) => TIPOS_DE_TEXTO.test(p.tipo ?? "") || (!p.tipo && p.corpo.subarray(0, 1).toString("latin1") === "{")).map((p) => p.corpo.toString("utf8"))
    : [corpo.toString("utf8")];
  const eventos: Objeto[] = [];
  for (const t of textos) {
    const s = t.trim();
    if (s.startsWith("{")) {
      try {
        const j = JSON.parse(s) as unknown;
        if (j && typeof j === "object" && !Array.isArray(j)) eventos.push(j as Objeto);
      } catch {
        // Corpo torto: não é evento.
      }
    } else if (s.startsWith("<")) {
      const e = eventoDoXml(s);
      if (e) eventos.push(e);
    }
  }
  return eventos;
}

export interface AcessoHikvision {
  maior: number | null;
  menor: number | null;
  /** Número do aluno no aparelho (o `identificador_catraca`), quando ele reconheceu a pessoa. */
  employeeNo: string | null;
  /** Número do cartão lido, quando o aparelho não ligou o cartão a ninguém. */
  cartao: string | null;
  /** A leitura veio de um QR ou código de barras: não identifica aluno. */
  codigo: boolean;
  serial: number | null;
  /** O aparelho está esperando a decisão do Gateway na resposta. */
  pedeDecisao: boolean;
  /** O aviso que vem depois da decisão, com o resultado. */
  resultadoDaDecisao: string | null;
  emTempoReal: boolean | null;
  quando: Date | null;
  leitor: number | null;
}

/** O evento de acesso, ou null para os outros (alarme, porta, batimento). */
export function acessoDoEvento(ev: Objeto): AcessoHikvision | null {
  if (String(ev.eventType ?? "") !== "AccessControllerEvent") return null;
  const d = (ev.AccessControllerEvent && typeof ev.AccessControllerEvent === "object" ? ev.AccessControllerEvent : {}) as Objeto;
  const empregado = texto(d.employeeNoString) ?? (numero(d.employeeNo) ? String(numero(d.employeeNo)) : null);
  const quando = texto(d.time) ?? texto(ev.dateTime);
  const data = quando ? new Date(quando) : null;
  return {
    maior: numero(d.majorEventType),
    menor: numero(d.subEventType),
    employeeNo: empregado,
    cartao: texto(d.cardNo),
    codigo: numero(d.swipeCardType) === 1 || numero(d.cardReaderKind) === 3 || !!texto(d.QRCodeInfo),
    serial: numero(d.serialNo),
    pedeDecisao: booleano(d.remoteCheck) === true,
    resultadoDaDecisao: texto(d.remoteCheckResult),
    emTempoReal: booleano(d.currentEvent),
    quando: data && !Number.isNaN(data.getTime()) ? data : null,
    leitor: numero(d.cardReaderNo),
  };
}

/** Os acessos que o aparelho reconheceu e liberou (tipo principal 5), por credencial. */
const ACEITOS = new Set([
  0x01, 0x02, 0x26, 0x28, 0x2b, 0x2e, 0x36, 0x39, 0x3c, 0x3f, 0x42, 0x45, 0x48, 0x4b, 0x4d, 0x65, 0x69, 0x90, 0x99, 0xbe, 0xe2, 0xe3,
]);

/** Os acessos que o aparelho negou: credencial desconhecida, fora da validade, sem permissão, falha de reconhecimento. */
const NEGADOS = new Set([
  0x03, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x27, 0x29, 0x2c, 0x2f, 0x31, 0x37, 0x3a, 0x3d, 0x40, 0x43, 0x46, 0x49, 0x4c, 0x4e, 0x50, 0x66, 0x70,
  0x71, 0x75, 0x76, 0x96, 0x97, 0x98, 0x9b, 0x9d, 0xbf, 0xe4,
]);

export function classificarAcesso(a: AcessoHikvision): "aceito" | "negado" | "outro" {
  if (a.maior !== null && a.maior !== 5) return "outro";
  if (a.menor === null) return "outro";
  if (ACEITOS.has(a.menor)) return "aceito";
  if (NEGADOS.has(a.menor)) return "negado";
  return "outro";
}

/**
 * O número que vai à nuvem: o do aluno, quando o aparelho reconheceu a
 * pessoa (rosto, digital ou cartão cadastrado nele); senão o do cartão lido,
 * sem zeros à esquerda e em maiúsculas — é o que a recepção põe na ficha,
 * como na Toletus e na Intelbras. QR e código de barras não identificam
 * ninguém (a regra mora em `core/credencial.ts`, e quem chama passa por ela).
 */
export function numeroDoAcesso(a: AcessoHikvision): string | null {
  if (a.employeeNo && a.employeeNo !== "0") return a.employeeNo;
  if (a.cartao) return a.cartao.trim().toUpperCase().replace(/^0+(?=.)/, "") || null;
  return null;
}

/** O aparelho está esperando a decisão agora, ou é um pedido antigo que ninguém espera mais? */
export function ehPedidoDeAgora(a: AcessoHikvision, agora: Date = new Date()): boolean {
  if (!a.pedeDecisao || a.emTempoReal === false) return false;
  if (!a.quando) return true;
  return Math.abs(agora.getTime() - a.quando.getTime()) <= JANELA_TEMPO_REAL_MS;
}

/**
 * A decisão, na resposta do POST do aparelho. `info` é o texto que o aparelho
 * pode mostrar, e a tela é pública: boas-vindas sem o nome, negativa sem
 * falar de dinheiro (a frase de todas as marcas, `mensagemDoDisplay`).
 */
export function respostaDaDecisao(serial: number | null, liberado: boolean, motivo = ""): Objeto {
  return {
    RemoteCheck: {
      serialNo: serial ?? 0,
      checkResult: liberado ? "success" : "failed",
      info: mensagemDoDisplay(liberado, motivo),
    },
  };
}
