/**
 * A camada de análise do Vigia: o que vai para o modelo, o que ele pode
 * responder e como a resposta é conferida. Sem Deno nem Supabase, para os
 * testes (src/lib/vigiaAnalise.test.ts) importarem direto.
 *
 * O Vigia é um agente só, em duas camadas que se completam: as **regras**
 * (public.vigia_detectar, no banco) reconhecem o que já se sabe tratar; a
 * **análise** olha o quadro inteiro de uma vez — é ela que percebe que duas
 * catracas da mesma academia caíram juntas porque a internet de lá caiu — e
 * escolhe ferramentas de um catálogo fechado.
 *
 * **O que vai para o modelo é telemetria técnica, e só isso.** Tipos de
 * anomalia, contagens, minutos e pseudônimos que valem só dentro de uma
 * análise (A1 = uma academia, G1 = um Gateway). Nenhum nome, e-mail, CPF, id
 * do banco ou texto livre — nem mensagem de erro, que pode carregar valor de
 * coluna: o erro vai só pela classe. `validarQuadro` é uma lista do que é
 * **permitido**, não do que é proibido: chave desconhecida ou texto fora do
 * formato recusa o quadro inteiro, e aí nada sai. É isso que permite usar um
 * modelo que processa fora do Brasil sem contrariar a Política de
 * Privacidade — o que sai não é dado pessoal. Sem texto livre, também não há
 * por onde um texto plantado num log (injeção de instrução) chegar ao modelo.
 *
 * **O modelo não decide o que pode rodar sozinho.** A classe de cada ação
 * (sozinho, aprovação, pessoa) é do catálogo, escrita aqui; a confiança que o
 * modelo declara é guardada para a avaliação e não decide nada. Uma ação só
 * é "sozinho" se continua inofensiva mesmo com o diagnóstico errado.
 */

// ── O quadro ───────────────────────────────────────────────────────────────

export const TIPOS_ANOMALIA = [
  "gateway_sem_sinal",
  "gateway_contingencia",
  "gateway_sincronizacao_atrasada",
  "gateway_fila_parada",
  "gateway_erro_recente",
  "gateway_ordens_com_falha",
  "rotina_falhou",
  "rotina_atrasada",
  "reconciliacao_com_erro",
  "reconciliacao_atrasada",
  "assinaturas_orfas",
  "divergencias_nao_corrigidas",
  "webhook_nao_processado",
  "banco_capacidade",
  "remocao_biometrica_parada",
] as const;

export const CLASSES_ERRO = [
  "tempo_esgotado",
  "permissao",
  "objeto_inexistente",
  "duplicidade",
  "restricao",
  "conexao",
  "envio_email",
  "servico_externo",
  "outro",
] as const;

export type Anomalia = {
  id: number;
  tipo: (typeof TIPOS_ANOMALIA)[number];
  academia?: string;
  gateway?: string;
  rotina?: string;
  evento?: string;
  classe_erro?: (typeof CLASSES_ERRO)[number];
  repetivel?: boolean;
  dentro_do_horario?: boolean;
  minutos?: number;
  quantidade?: number;
  percentual?: number;
  falhas_7d?: number;
  execucoes_7d?: number;
  fila_offline?: number;
};

export type Quadro = {
  hora_local: number;
  dia_semana: number;
  plataforma: { gateways: number; gateways_no_ar: number; academias_com_gateway: number };
  academias: { academia: string; gateways: number; gateways_no_ar: number }[];
  anomalias: Anomalia[];
  vigia: { regra: string; gateway?: string; rotina?: string }[];
};

const ACADEMIA = /^A\d{1,3}$/;
const GATEWAY = /^G\d{1,3}$/;
const ROTINA = /^[a-z0-9-]{1,63}$/;
const EVENTO = /^[A-Z_]{1,40}$/;
const REGRA = /^[a-z_]{1,63}$/;

type Campo = "inteiro" | "numero" | "booleano" | RegExp | readonly string[];

const CAMPOS_ANOMALIA: Record<string, Campo> = {
  id: "inteiro",
  tipo: TIPOS_ANOMALIA,
  academia: ACADEMIA,
  gateway: GATEWAY,
  rotina: ROTINA,
  evento: EVENTO,
  classe_erro: CLASSES_ERRO,
  repetivel: "booleano",
  dentro_do_horario: "booleano",
  minutos: "inteiro",
  quantidade: "inteiro",
  percentual: "numero",
  falhas_7d: "inteiro",
  execucoes_7d: "inteiro",
  fila_offline: "inteiro",
};
const OBRIGATORIOS_ANOMALIA = ["id", "tipo"];

const CAMPOS_PLATAFORMA: Record<string, Campo> = {
  gateways: "inteiro",
  gateways_no_ar: "inteiro",
  academias_com_gateway: "inteiro",
};
const CAMPOS_ACADEMIA: Record<string, Campo> = { academia: ACADEMIA, gateways: "inteiro", gateways_no_ar: "inteiro" };
const CAMPOS_VIGIA: Record<string, Campo> = { regra: REGRA, gateway: GATEWAY, rotina: ROTINA };

const LIMITE_LISTA = 60;
const LIMITE_NUMERO = 10_000_000;

function campoValido(valor: unknown, tipo: Campo): boolean {
  if (tipo === "booleano") return typeof valor === "boolean";
  if (tipo === "inteiro") return Number.isInteger(valor) && (valor as number) >= 0 && (valor as number) <= LIMITE_NUMERO;
  if (tipo === "numero") return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 && valor <= LIMITE_NUMERO;
  if (typeof valor !== "string") return false;
  return tipo instanceof RegExp ? tipo.test(valor) : tipo.includes(valor);
}

function objetoValido(o: unknown, campos: Record<string, Campo>, obrigatorios: string[], onde: string): string | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return `${onde}: não é um objeto`;
  for (const [chave, valor] of Object.entries(o)) {
    const tipo = campos[chave];
    if (!tipo) return `${onde}: campo não permitido (${chave.slice(0, 40)})`;
    if (!campoValido(valor, tipo)) return `${onde}: valor fora do formato em ${chave}`;
  }
  for (const c of obrigatorios) if (!(c in (o as Record<string, unknown>))) return `${onde}: falta ${c}`;
  return null;
}

function listaValida(l: unknown, campos: Record<string, Campo>, obrigatorios: string[], onde: string): string | null {
  if (!Array.isArray(l)) return `${onde}: não é uma lista`;
  if (l.length > LIMITE_LISTA) return `${onde}: mais de ${LIMITE_LISTA} itens`;
  for (let i = 0; i < l.length; i++) {
    const erro = objetoValido(l[i], campos, obrigatorios, `${onde}[${i}]`);
    if (erro) return erro;
  }
  return null;
}

/**
 * Confere o quadro contra a lista do que é permitido. Qualquer coisa fora
 * dela recusa o quadro inteiro — melhor não analisar do que mandar um campo
 * que ninguém conferiu.
 */
export function validarQuadro(q: unknown): { ok: true; quadro: Quadro } | { ok: false; motivo: string } {
  const recusa = (motivo: string) => ({ ok: false as const, motivo });
  if (!q || typeof q !== "object" || Array.isArray(q)) return recusa("quadro: não é um objeto");
  const permitidas = ["hora_local", "dia_semana", "plataforma", "academias", "anomalias", "vigia"];
  for (const chave of Object.keys(q)) if (!permitidas.includes(chave)) return recusa(`quadro: campo não permitido (${chave.slice(0, 40)})`);
  const x = q as Record<string, unknown>;
  if (!Number.isInteger(x.hora_local) || (x.hora_local as number) < 0 || (x.hora_local as number) > 23) return recusa("quadro: hora_local");
  if (!Number.isInteger(x.dia_semana) || (x.dia_semana as number) < 0 || (x.dia_semana as number) > 6) return recusa("quadro: dia_semana");
  const erro =
    objetoValido(x.plataforma, CAMPOS_PLATAFORMA, Object.keys(CAMPOS_PLATAFORMA), "plataforma") ??
    listaValida(x.academias, CAMPOS_ACADEMIA, ["academia"], "academias") ??
    listaValida(x.anomalias, CAMPOS_ANOMALIA, OBRIGATORIOS_ANOMALIA, "anomalias") ??
    listaValida(x.vigia, CAMPOS_VIGIA, ["regra"], "vigia");
  if (erro) return recusa(erro);
  if ((x.anomalias as unknown[]).length === 0) return recusa("quadro: sem anomalias");
  return { ok: true, quadro: q as Quadro };
}

// ── O catálogo de ferramentas ─────────────────────────────────────────────

export type Classe = "sozinho" | "aprovacao" | "humano";
type Alvo = "gateway" | "academia" | "rotina" | "evento" | "plataforma";

/**
 * Tudo o que o Vigia pode propor. Fica **fora** daqui, e por isso fora do
 * alcance do modelo: liberar catraca, limpar a fila do Gateway (a fila guarda
 * acessos que viram presença), apagar registros, mudar situação ou plano de
 * aluno, ação financeira fora dos caminhos existentes, schema, RLS e
 * segredos. Evoluir o catálogo é mudar este arquivo, com revisão.
 */
export const FERRAMENTAS: Record<string, { rotulo: string; alvo: Alvo; classe: Classe | "depende"; descricao: string }> = {
  sincronizar_gateway: {
    rotulo: "Sincronizar o Gateway",
    alvo: "gateway",
    classe: "sozinho",
    descricao: "Pede ao Gateway que baixe de novo a lista completa de alunos da nuvem.",
  },
  reenviar_acessos_gateway: {
    rotulo: "Reenviar os acessos guardados",
    alvo: "gateway",
    classe: "sozinho",
    descricao: "Pede ao Gateway que suba os acessos que guardou enquanto decidia sem a nuvem.",
  },
  pedir_diagnostico_gateway: {
    rotulo: "Pedir diagnóstico ao Gateway",
    alvo: "gateway",
    classe: "sozinho",
    descricao: "Pede ao Gateway um diagnóstico só de leitura: conexão, equipamentos e fila.",
  },
  vencer_ordens_paradas: {
    rotulo: "Vencer ordens paradas",
    alvo: "gateway",
    classe: "sozinho",
    descricao: "Encerra ordens ao Gateway que passaram do prazo sem resposta (a remoção de digital vira tarefa).",
  },
  reenviar_remocao_digital: {
    rotulo: "Reenviar a remoção da digital",
    alvo: "gateway",
    classe: "sozinho",
    descricao: "Reenvia ao Gateway a ordem de apagar do equipamento a digital de quem revogou a autorização.",
  },
  reexecutar_rotina: {
    rotulo: "Rodar a rotina de novo",
    alvo: "rotina",
    classe: "depende",
    descricao: "Roda de novo uma rotina agendada que falhou. Só roda sozinha se a rotina é repetível (sem efeito duplicado).",
  },
  reconferir_asaas: {
    rotulo: "Conferir o Asaas de novo",
    alvo: "plataforma",
    classe: "sozinho",
    descricao: "Roda de novo a conferência de cobranças entre o Asaas e o banco.",
  },
  reprocessar_evento_asaas: {
    rotulo: "Reprocessar aviso do Asaas",
    alvo: "evento",
    classe: "aprovacao",
    descricao: "Processa de novo os avisos de pagamento do Asaas daquele tipo que falharam.",
  },
  cancelar_assinatura_orfa: {
    rotulo: "Cancelar assinatura órfã",
    alvo: "plataforma",
    classe: "aprovacao",
    descricao: "Cancela no Asaas assinatura que cobra alguém sem registro no banco.",
  },
  reiniciar_gateway: {
    rotulo: "Reiniciar o Gateway",
    alvo: "gateway",
    classe: "aprovacao",
    descricao: "Reinicia o programa do Gateway no computador da academia (ainda não disponível).",
  },
  acionar_academia: {
    rotulo: "Falar com a academia",
    alvo: "academia",
    classe: "humano",
    descricao: "Uma pessoa da ArkeFit fala com a academia: internet, computador da recepção ou equipamento.",
  },
  acionar_suporte_arkefit: {
    rotulo: "Investigar na plataforma",
    alvo: "plataforma",
    classe: "humano",
    descricao: "Uma pessoa da ArkeFit investiga na plataforma: configuração, código ou fornecedor.",
  },
};

export const CAUSAS = [
  "internet_da_academia",
  "computador_da_catraca",
  "equipamento_da_catraca",
  "nuvem_arke",
  "servico_externo",
  "rotina_do_banco",
  "configuracao",
  "indeterminada",
] as const;

export const GRAVIDADES = ["baixa", "media", "alta", "critica"] as const;

export const ROTULO_CAUSA: Record<(typeof CAUSAS)[number], string> = {
  internet_da_academia: "Internet da academia",
  computador_da_catraca: "Computador da catraca",
  equipamento_da_catraca: "Equipamento da catraca",
  nuvem_arke: "Nuvem da ArkeFit",
  servico_externo: "Serviço externo",
  rotina_do_banco: "Rotina do banco",
  configuracao: "Configuração",
  indeterminada: "Indeterminada",
};

export const ROTULO_CLASSE: Record<Classe, string> = {
  sozinho: "faria sozinho",
  aprovacao: "pediria aprovação",
  humano: "pede uma pessoa",
};

export const ROTULO_RECUSA: Record<NonNullable<AcaoProposta["recusada"]>, string> = {
  fora_do_catalogo: "recusada: fora da lista de ferramentas",
  alvo_inexistente: "recusada: alvo que não está no quadro",
  alvo_sem_sinal: "recusada: Gateway sem sinal, a ordem não chegaria",
  freio_falha_geral: "segurada: a mesma ordem para muitos Gateways (freio de falha geral)",
};

export const NOME_FERRAMENTA_ANALISE = "registrar_analise";

const SISTEMA = [
  "Você é o Vigia, o agente de saúde técnica da plataforma ARKE, usada por academias.",
  "Como o sistema funciona: em cada academia, o Gateway Local roda num computador da recepção e liga as catracas à nuvem;",
  "sem nuvem ele decide pelo cadastro guardado (contingência) e guarda os acessos numa fila para subir depois.",
  "A nuvem é o Supabase (banco e funções), com rotinas agendadas. As cobranças passam pelo Asaas, que avisa o sistema por webhook.",
  "",
  "Você recebe um quadro de anomalias técnicas, sem dados de pessoas. A1, A2… são academias; G1, G2… são Gateways de catraca.",
  "hora_local e dia_semana (0 = domingo) são de Brasília: academia fechada de madrugada explica catraca sem sinal.",
  "`gateways_no_ar` conta os Gateways que falaram com a nuvem nos últimos 3 minutos: Gateway no ar prova que a internet",
  "e o computador de lá funcionam — um problema dele com o Gateway no ar (lista atrasada, fila parada) é do Gateway ou da nuvem, não da rede.",
  "`minutos` é há quanto tempo a anomalia está de pé; `repetivel` diz se a rotina pode rodar de novo sem efeito duplicado.",
  "Gateway sem sinal não recebe ordem nenhuma — e, quando volta, ele mesmo sobe a fila e sincroniza. Não proponha ferramenta",
  "de Gateway para um Gateway sem sinal, nem \"para depois que voltar\": o que resolve um Gateway sem sinal é a academia.",
  "Contingência é o Gateway no ar e com a lista de alunos, mas a nuvem demorando a responder a validação: sincronizar não",
  "resolve (a lista já está lá). Quando a causa é comum a várias academias — nuvem ou fornecedor —, não mande ordem a cada",
  "Gateway: isso sobrecarrega a nuvem que já está lenta. Acione o suporte da ArkeFit e deixe os Gateways se recuperarem.",
  "O campo `vigia` lista o que as regras automáticas já estão tratando: complemente, não repita.",
  "",
  "Sua tarefa: explicar a causa provável olhando as anomalias em conjunto — várias catracas da mesma academia ao mesmo tempo",
  "apontam para a rede ou o computador de lá; várias academias ao mesmo tempo apontam para a nuvem ou um fornecedor —",
  "e escolher ações do catálogo da ferramenta.",
  "",
  "Regras:",
  "- Use só ferramentas do catálogo. O alvo é um pseudônimo presente no quadro (G…, A…), o nome de uma rotina do quadro,",
  "  o tipo de evento do quadro, ou a palavra plataforma.",
  "- Prefira a menor ação suficiente. Se nenhuma ação ajuda agora, deixe a lista vazia e diga o que observar.",
  "- Não invente números nem fatos que não estão no quadro.",
  "- confianca: de 0 a 100, o quanto você acredita que o diagnóstico está certo.",
  "- Escreva em português do Brasil. Diagnóstico em até três frases.",
].join("\n");

export function esquemaAnalise() {
  const catalogo = Object.entries(FERRAMENTAS)
    .map(([nome, f]) => `${nome} (alvo: ${f.alvo}): ${f.descricao}`)
    .join("\n");
  return {
    name: NOME_FERRAMENTA_ANALISE,
    description: `Registra o diagnóstico do quadro e as ações propostas.\n\nCatálogo de ferramentas:\n${catalogo}`,
    inputSchema: {
      json: {
        type: "object",
        required: ["diagnostico", "causa_provavel", "gravidade", "confianca", "acoes"],
        properties: {
          diagnostico: { type: "string", description: "Causa provável e o que está acontecendo, em até três frases." },
          causa_provavel: { type: "string", enum: [...CAUSAS] },
          gravidade: { type: "string", enum: [...GRAVIDADES] },
          confianca: { type: "integer", minimum: 0, maximum: 100 },
          anomalias_relacionadas: {
            type: "array",
            items: { type: "integer" },
            description: "ids das anomalias que o diagnóstico explica.",
          },
          acoes: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              required: ["ferramenta", "alvo", "justificativa"],
              properties: {
                ferramenta: { type: "string", enum: Object.keys(FERRAMENTAS) },
                alvo: { type: "string" },
                justificativa: { type: "string", description: "Por que esta ação, em uma frase." },
              },
            },
          },
        },
      },
    },
  };
}

/** O corpo da chamada ao Bedrock (Converse), com a ferramenta forçada. */
export function montarPedido(quadro: Quadro) {
  return {
    system: [{ text: SISTEMA }],
    messages: [{ role: "user", content: [{ text: `Quadro atual:\n${JSON.stringify(quadro)}` }] }],
    inferenceConfig: { maxTokens: 1500, temperature: 0.2 },
    toolConfig: {
      tools: [{ toolSpec: esquemaAnalise() }],
      toolChoice: { tool: { name: NOME_FERRAMENTA_ANALISE } },
    },
  };
}

// ── A resposta ─────────────────────────────────────────────────────────────

export type AcaoProposta = {
  ferramenta: string;
  alvo: string;
  justificativa: string;
  classe: Classe | null;
  recusada?: "fora_do_catalogo" | "alvo_inexistente" | "alvo_sem_sinal" | "freio_falha_geral";
};

/**
 * Freio de falha geral, o mesmo das regras (freio_alvos = 3): a mesma ordem
 * para muitos Gateways numa análise só é sintoma tratado um a um. O simulado
 * mostrou o modelo acertando "nuvem lenta" e, mesmo assim, mandando
 * sincronizar cada Gateway — com cem academias seriam cem downloads da lista
 * inteira em cima de uma nuvem que já não responde. Quem segura é o catálogo,
 * não o modelo.
 */
export const FREIO_ALVOS = 3;

export function aplicarFreio(acoes: AcaoProposta[]): AcaoProposta[] {
  const alvos = new Map<string, Set<string>>();
  for (const a of acoes) {
    if (a.recusada || FERRAMENTAS[a.ferramenta]?.alvo !== "gateway") continue;
    alvos.set(a.ferramenta, (alvos.get(a.ferramenta) ?? new Set()).add(a.alvo));
  }
  return acoes.map((a) =>
    !a.recusada && (alvos.get(a.ferramenta)?.size ?? 0) >= FREIO_ALVOS
      ? { ...a, classe: null, recusada: "freio_falha_geral" as const }
      : a,
  );
}

export type Analise = {
  diagnostico: string;
  causa_provavel: (typeof CAUSAS)[number];
  gravidade: (typeof GRAVIDADES)[number] | null;
  confianca: number | null;
  anomalias_relacionadas: number[];
  acoes: AcaoProposta[];
};

function alvoExiste(tipo: Alvo, alvo: string, q: Quadro): boolean {
  switch (tipo) {
    case "plataforma":
      return alvo === "plataforma";
    case "gateway":
      return GATEWAY.test(alvo) && (q.anomalias.some((a) => a.gateway === alvo) || q.vigia.some((v) => v.gateway === alvo));
    case "academia":
      return ACADEMIA.test(alvo) && (q.anomalias.some((a) => a.academia === alvo) || q.academias.some((a) => a.academia === alvo));
    case "rotina":
      return q.anomalias.some((a) => a.rotina === alvo);
    case "evento":
      return q.anomalias.some((a) => a.evento === alvo);
  }
}

/**
 * A classe sai do catálogo, nunca do modelo. A única que depende do alvo é
 * rodar de novo uma rotina: sozinho só quando o quadro diz que ela é
 * repetível — e quem diz isso é o banco (public.vigia_rotina_repetivel), uma
 * lista só para as duas camadas.
 */
export function classificarAcao(ferramenta: string, alvo: string, q: Quadro): Pick<AcaoProposta, "classe" | "recusada"> {
  const f = FERRAMENTAS[ferramenta];
  if (!f) return { classe: null, recusada: "fora_do_catalogo" };
  if (!alvoExiste(f.alvo, alvo, q)) return { classe: null, recusada: "alvo_inexistente" };
  // Ordem a Gateway sem sinal não chega — e, quando ele volta, sobe a fila e
  // sincroniza sozinho. É a mesma trava das regras, que só agem em Gateway
  // no ar; o simulado mostrou o modelo propondo essas ordens "para depois".
  if (f.alvo === "gateway" && q.anomalias.some((a) => a.gateway === alvo && a.tipo === "gateway_sem_sinal")) {
    return { classe: null, recusada: "alvo_sem_sinal" };
  }
  if (f.classe === "depende") {
    const repetivel = q.anomalias.some((a) => a.rotina === alvo && a.repetivel === true);
    return { classe: repetivel ? "sozinho" : "aprovacao" };
  }
  return { classe: f.classe };
}

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function interpretarResposta(
  resposta: unknown,
  q: Quadro,
): { ok: true; analise: Analise } | { ok: false; motivo: string } {
  const conteudo = (resposta as { output?: { message?: { content?: unknown[] } } })?.output?.message?.content;
  const bloco = Array.isArray(conteudo)
    ? (conteudo.find(
        (c) => (c as { toolUse?: { name?: string } })?.toolUse?.name === NOME_FERRAMENTA_ANALISE,
      ) as { toolUse: { input?: unknown } } | undefined)
    : undefined;
  const e = bloco?.toolUse?.input as Record<string, unknown> | undefined;
  if (!e || typeof e !== "object") return { ok: false, motivo: "o modelo não chamou a ferramenta de análise" };

  const diagnostico = texto(e.diagnostico, 800);
  if (!diagnostico) return { ok: false, motivo: "diagnóstico vazio" };

  const causa = (CAUSAS as readonly string[]).includes(e.causa_provavel as string)
    ? (e.causa_provavel as Analise["causa_provavel"])
    : "indeterminada";
  const gravidade = (GRAVIDADES as readonly string[]).includes(e.gravidade as string)
    ? (e.gravidade as Analise["gravidade"])
    : null;
  const confianca =
    Number.isInteger(e.confianca) && (e.confianca as number) >= 0 && (e.confianca as number) <= 100
      ? (e.confianca as number)
      : null;
  const ids = new Set(q.anomalias.map((a) => a.id));
  const relacionadas = Array.isArray(e.anomalias_relacionadas)
    ? [...new Set(e.anomalias_relacionadas.filter((n): n is number => Number.isInteger(n) && ids.has(n)))]
    : [];

  const propostas: AcaoProposta[] = (Array.isArray(e.acoes) ? e.acoes : []).slice(0, 8).map((a) => {
    const item = (a ?? {}) as Record<string, unknown>;
    const ferramenta = texto(item.ferramenta, 60);
    const alvo = texto(item.alvo, 63);
    return {
      ferramenta,
      alvo,
      justificativa: texto(item.justificativa, 300),
      ...classificarAcao(ferramenta, alvo, q),
    };
  });

  return {
    ok: true,
    analise: {
      diagnostico,
      causa_provavel: causa,
      gravidade,
      confianca,
      anomalias_relacionadas: relacionadas,
      acoes: aplicarFreio(propostas),
    },
  };
}
