/**
 * Os acessos da equipe da ArkeFit à Visão Master (08/10/2026).
 *
 * Duas formas de acesso:
 *   - **Sócio**: os papéis `superadmin` e `admin_arke` em `user_roles`. Abre a
 *     Visão Master inteira, como as contas dos sócios de sempre;
 *   - **níveis** da equipe contratada (`equipe_arkefit.niveis`): Suporte,
 *     Mentor, Comercial e Financeiro. Cada nível abre áreas da Visão Master. A
 *     pessoa pode ter mais de um. **Nível nunca grava `user_roles`**: o
 *     `admin_arke` é gestor de toda academia, e nenhum nível é isso.
 *
 * A pergunta "esta pessoa abre esta área?" mora no banco, em
 * `acesso_arkefit(área)` (migrations 20261422010000 em diante), com as duas
 * etapas obrigatórias. Este arquivo é o espelho para a tela: o menu, o portão
 * de cada rota e as ações que cada tela mostra. A tela só não oferece o que o
 * banco recusaria; a regra é a do banco.
 *
 * O convite (`equipe-arkefit-convidar`) tem o espelho dos níveis em
 * `supabase/functions/equipe-arkefit-convidar/fluxo.ts`, e o banco a lista dos
 * que já podem ser dados em `niveis_arkefit_abertos()`. Ninguém recebe nível
 * antes de a área dele estar no ar: o Mentor e o Suporte vieram na entrega 1,
 * o Comercial e o Financeiro na entrega 2 (migrations 20261432010000 e
 * 20261433010000). `acessosArkefit.test.ts` e `acessosArkefit.guarda.test.ts`
 * conferem os três.
 */

export type PapelArkefit = "superadmin" | "admin_arke";

export type AcessoArkefit = {
  /** O que vai no pedido do convite e na auditoria. */
  id: string;
  /** Como a tela chama o nível. */
  nome: string;
  /** Uma frase para o formulário: o que a pessoa vê e faz. */
  descricao: string;
  /** Os papéis de `user_roles` que o nível dá. */
  papeis: readonly PapelArkefit[];
};

export const ACESSOS_ARKEFIT: readonly AcessoArkefit[] = [
  {
    id: "socio",
    nome: "Sócio",
    descricao:
      "A Visão Master inteira, inclusive a equipe e o dinheiro, e a gestão de qualquer academia. É o mesmo acesso dos sócios de hoje.",
    papeis: ["superadmin", "admin_arke"],
  },
];

/** Todos os papéis que algum acesso dá: os que a ArkeFit concede e tira. */
export const PAPEIS_ARKEFIT: readonly PapelArkefit[] = [...new Set(ACESSOS_ARKEFIT.flatMap((a) => a.papeis))];

export function acessoPorId(id: unknown): AcessoArkefit | null {
  if (typeof id !== "string") return null;
  return ACESSOS_ARKEFIT.find((a) => a.id === id) ?? null;
}

/** O acesso que tem exatamente estes papéis, ou nulo (conta montada à mão, ou só com nível). */
export function acessoDosPapeis(papeis: readonly string[]): AcessoArkefit | null {
  if (!papeis.length) return null;
  const chave = (lista: readonly string[]) => [...new Set(lista)].sort().join(",");
  const procurado = chave(papeis);
  return ACESSOS_ARKEFIT.find((a) => chave(a.papeis) === procurado) ?? null;
}

// ── Os níveis da equipe contratada ─────────────────────────────────────────

export type NivelArkefit = "suporte" | "mentor" | "comercial" | "financeiro";

export type Nivel = {
  id: NivelArkefit;
  nome: string;
  /** O que a pessoa vê e faz, para o convite e para a Central de Ajuda. */
  descricao: string;
  /** O que ela nunca vê. */
  nunca: string;
  /** Já pode ser dado: a área dele está no ar. */
  aberto: boolean;
};

export const NIVEIS: readonly Nivel[] = [
  {
    id: "suporte",
    nome: "Suporte",
    descricao:
      "Atende as academias: a carteira de academias e autônomos (sem valores), os chamados e as avaliações, a implantação, os equipamentos, o Vigia (só para ler) e as rotinas.",
    nunca: "Não vê dinheiro, nem dado de aluno ou de saúde, e não faz o que é do Sócio (simular perfil, trial, trocar o e-mail do gestor, excluir academia).",
    aberto: true,
  },
  {
    id: "mentor",
    nome: "Mentor",
    descricao:
      "Atende os alunos do Método ARKE: a fila, as conversas, a carteira e a ficha, as metas, a fase e a prescrição (treino com CREF, dieta com CRN).",
    nunca: "Não vê aluno do plano Free, dinheiro, as academias nem a equipe, e não define o mentor de cada aluno.",
    aberto: true,
  },
  {
    id: "comercial",
    nome: "Comercial",
    descricao:
      "O Pipeline (os contatos e a Letícia em cada um), o funil de conversão, a carteira de academias (sem valores), a academia nova e o cadastro dela (nome, tipo, CNPJ e telefone) e o profissional autônomo.",
    nunca: "Não vê dinheiro nem dado de aluno, não liga nem desliga a Letícia e não dá trial: a academia nova nasce ativa.",
    aberto: true,
  },
  {
    id: "financeiro",
    nome: "Financeiro",
    descricao:
      "Os indicadores e a receita, o MRR de cada academia, a mensalidade B2B (plano e valor), o repasse do Método, a taxa de implantação, as cobranças B2B, a conta das cobranças, os avisos do Asaas e a reconciliação.",
    nunca: "Não vê dado de aluno nem de saúde, e não muda o status da academia, nem a cancela, exclui ou dá trial (é do Sócio).",
    aberto: true,
  },
];

/** Os níveis que já podem ser dados. Espelho de `niveis_arkefit_abertos()` no banco. */
export const NIVEIS_ABERTOS: readonly NivelArkefit[] = NIVEIS.filter((n) => n.aberto).map((n) => n.id);

export function nivelPorId(id: unknown): Nivel | null {
  if (typeof id !== "string") return null;
  return NIVEIS.find((n) => n.id === id) ?? null;
}

/** Os níveis que vieram do banco, sem repetir e na ordem da lista; o desconhecido fica de fora. */
export function lerNiveis(valor: unknown): NivelArkefit[] {
  if (!Array.isArray(valor)) return [];
  return NIVEIS.map((n) => n.id).filter((id) => valor.includes(id));
}

/** "Mentor e Suporte". */
export function nomeDosNiveis(niveis: readonly string[]): string {
  const nomes = lerNiveis(niveis).map((id) => nivelPorId(id)!.nome);
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

// ── As áreas ───────────────────────────────────────────────────────────────

export type AreaArkefit = "carteira" | "cadastro" | "comercial" | "suporte" | "operacao" | "mentoria" | "financeiro" | "socio";

/**
 * Os níveis que abrem cada área. O Sócio abre todas. É o mesmo `case` de
 * `acesso_arkefit()` no banco: `acessosArkefit.guarda.test.ts` falha se os
 * dois divergirem.
 */
export const NIVEIS_DA_AREA: Record<AreaArkefit, readonly NivelArkefit[]> = {
  carteira: ["suporte", "comercial", "financeiro"],
  cadastro: ["comercial"],
  comercial: ["comercial"],
  suporte: ["suporte"],
  operacao: ["suporte"],
  mentoria: ["mentor"],
  financeiro: ["financeiro"],
  socio: [],
};

/** O acesso de quem está na sessão: Sócio (o papel `superadmin`) e os níveis ativos. */
export type AcessoDaPessoa = { socio: boolean; niveis: readonly string[] };

export const SEM_ACESSO_ARKEFIT: AcessoDaPessoa = { socio: false, niveis: [] };

export function podeArea(acesso: AcessoDaPessoa, area: AreaArkefit): boolean {
  if (acesso.socio) return true;
  return NIVEIS_DA_AREA[area].some((n) => acesso.niveis.includes(n));
}

/** Entra na Visão Master: o Sócio, ou quem tem ao menos um nível. */
export function temAcessoArkefit(acesso: AcessoDaPessoa): boolean {
  return acesso.socio || lerNiveis(acesso.niveis).length > 0;
}

/** Como o cabeçalho chama o acesso de quem entrou. */
export function nomeDoAcessoDaPessoa(acesso: AcessoDaPessoa): string {
  return acesso.socio ? "Sócio" : nomeDosNiveis(acesso.niveis) || "Equipe ArkeFit";
}

// ── As rotas da Visão Master ───────────────────────────────────────────────

/**
 * As rotas filhas de /superadmin, como estão no App.tsx, e as áreas que abrem
 * cada uma (basta uma). "todos": quem entra na Visão Master. Rota fora da
 * tabela não abre (falha fechada). A ordem é a do menu: a rota inicial de
 * quem entra é a primeira que abre para ele.
 */
export const ROTAS_DA_VISAO_MASTER: Record<string, readonly AreaArkefit[] | "todos"> = {
  "": ["carteira"], // Visão Geral: a carteira; os indicadores e o funil são de outras áreas, por cartão
  mentoria: ["mentoria"],
  "mentoria/aluno/:alunoId": ["mentoria"],
  equipe: ["socio"],
  comercial: ["comercial"],
  contatos: ["comercial"], // endereço antigo do Pipeline
  implantacao: ["suporte"],
  suporte: ["suporte"],
  profissionais: ["carteira"],
  vigia: ["operacao"],
  ia: ["socio"],
  equipamentos: ["operacao"],
  webhooks: ["operacao", "financeiro"], // as rotinas são da operação; os avisos do Asaas, do financeiro
  auditoria: ["socio"],
  acervo: ["socio"],
  configuracoes: ["socio"],
  ajuda: "todos",
  "ajuda/:slug": "todos",
};

/** A rota da tabela que atende o endereço (`/superadmin/mentoria/aluno/x` → `mentoria/aluno/:alunoId`), ou null. */
export function rotaDaVisaoMaster(caminho: string): string | null {
  const resto = caminho.replace(/^\/superadmin\/?/, "").replace(/\/+$/, "");
  if (resto in ROTAS_DA_VISAO_MASTER) return resto;
  const partes = resto.split("/");
  for (const rota of Object.keys(ROTAS_DA_VISAO_MASTER)) {
    const molde = rota.split("/");
    if (molde.length === partes.length && molde.every((p, i) => p.startsWith(":") || p === partes[i])) return rota;
  }
  return null;
}

export function podeAbrirNaVisaoMaster(caminho: string, acesso: AcessoDaPessoa): boolean {
  if (!temAcessoArkefit(acesso)) return false;
  const rota = rotaDaVisaoMaster(caminho);
  if (rota === null) return false;
  const areas = ROTAS_DA_VISAO_MASTER[rota];
  return areas === "todos" || areas.some((a) => podeArea(acesso, a));
}

/** Para onde vai quem entra: a primeira rota do menu que abre para ele (o Mentor vai para a Mentoria). */
export function rotaInicial(acesso: AcessoDaPessoa): string {
  for (const rota of Object.keys(ROTAS_DA_VISAO_MASTER)) {
    if (rota.includes(":") || ROTAS_DA_VISAO_MASTER[rota] === "todos") continue;
    const caminho = rota ? `/superadmin/${rota}` : "/superadmin";
    if (podeAbrirNaVisaoMaster(caminho, acesso)) return caminho;
  }
  return "/superadmin/ajuda";
}

// ── As chamadas da Visão Master ────────────────────────────────────────────

export type Chamada = {
  /** A área que faz a chamada ("todos": a sessão de qualquer um, como sair). */
  area: AreaArkefit | "todos";
  /**
   * Por que a conferência no banco não é `acesso_arkefit('<área>')` (ou, no
   * Método, `equipe_metodo()`; no Sócio, o papel `superadmin`). Sem motivo,
   * `acessosArkefit.guarda.test.ts` cobra a conferência na última definição
   * da função.
   */
  motivo?: string;
};

const DA_ACADEMIA = "também é da academia (a equipe dela e o Admin ARKE, gestor de toda academia); o nível entra pela área";
const TABELA = "leitura ou gravação direta: quem decide é o RLS da tabela";
const CADASTRO_PROPRIO =
  "o cadastro da equipe (20261430): o sócio vê e grava o de todos, e cada um, em qualquer nível, o próprio; quem decide é o banco (pode_ver_cadastro_equipe_arkefit e as RPCs), com as duas etapas";

/**
 * Toda chamada ao banco das telas da Visão Master, e das libs e componentes
 * que elas usam (`.rpc`, `.functions.invoke`, `.from`, `.storage.from`), com
 * a área que a faz. Chamada nova fora da lista faz a guarda falhar (fechada):
 * quem a escreve diz de que área ela é, e a tela a esconde de quem não a abre.
 */
export const CHAMADAS_DA_VISAO_MASTER: Record<string, Chamada> = {
  // O cadastro completo da equipe (Meu cadastro, no rodapé do menu, e o botão Cadastro da Equipe)
  "from:equipe_arkefit_cadastro": { area: "todos", motivo: CADASTRO_PROPRIO },
  "rpc:salvar_cadastro_equipe_arkefit": { area: "todos", motivo: CADASTRO_PROPRIO },
  "rpc:exportar_cadastros_equipe_arkefit": { area: "todos", motivo: CADASTRO_PROPRIO },
  "storage:equipe-arkefit-documentos": { area: "todos", motivo: CADASTRO_PROPRIO },
  "rpc:renomear_equipe_arkefit": { area: "socio", motivo: "do Sócio: confere has_role(v_ator, 'superadmin') (20261430 e 20261431)" },
  // Visão Geral
  "rpc:get_superadmin_tenants": { area: "carteira" },
  "rpc:get_superadmin_fila_global": { area: "carteira" },
  "rpc:get_superadmin_overview": { area: "financeiro" },
  "rpc:get_superadmin_receita_historica": { area: "financeiro" },
  "rpc:get_superadmin_funil_conversao": { area: "comercial" },
  "rpc:get_superadmin_funil_sinais": { area: "comercial" },
  "rpc:get_superadmin_adocao_metodologia": { area: "socio" },
  "rpc:get_superadmin_perfis_simulaveis": { area: "socio" },
  "fn:impersonar-perfil": { area: "socio" },
  "fn:criar-organizacao-superadmin": { area: "cadastro" },
  "fn:superadmin-suporte-tenant": { area: "operacao" },
  "fn:asaas-emitir-cobranca-b2b": { area: "financeiro" },
  "rpc:atualizar_cadastro_organizacao": { area: "cadastro" },
  "rpc:definir_mensalidade_b2b": { area: "financeiro" },
  "from:organizations": {
    area: "financeiro",
    motivo:
      "leitura direta: o RLS abre a academia ao Financeiro (20261433); a escrita direta que sobrou na tela é o status e o trial, do Sócio",
  },
  "from:planos_b2b_precos": { area: "cadastro", motivo: TABELA },
  // Ficha da organização
  "rpc:get_superadmin_organizacao_atividade": { area: "socio" },
  "rpc:get_superadmin_alunos_trial": { area: "socio" },
  "rpc:iniciar_trial_metodo_arke": { area: "socio" },
  "rpc:encerrar_trial_metodo_arke": { area: "socio" },
  "rpc:arke_trial_dias": { area: "socio", motivo: "a duração do trial, um número da plataforma" },
  "rpc:valor_mensal_b2b": { area: "financeiro" },
  "fn:asaas-assinatura-b2b": { area: "financeiro" },
  "from:taxas_implantacao": { area: "financeiro", motivo: TABELA },
  "from:cobrancas_b2b": { area: "financeiro", motivo: TABELA },
  "fn:asaas-taxa-implantacao": { area: "financeiro" },
  "rpc:aplicar_repasse_referencia": { area: "financeiro" },
  "rpc:definir_repasse_organizacao": { area: "financeiro" },
  "rpc:definir_repasse_por_nivel": { area: "financeiro" },
  "from:organization_planos_precificacao": { area: "financeiro", motivo: TABELA },
  "rpc:arke_taxa_processamento_config": { area: "financeiro", motivo: "a taxa do gateway, um número da plataforma" },
  "from:planos_atacado": { area: "financeiro", motivo: TABELA },
  "rpc:situacao_cobranca_conta_academia": { area: "financeiro" },
  "fn:asaas-conta-academia": { area: "financeiro" },
  "from:organizacao_encerramentos": { area: "socio", motivo: TABELA },
  "rpc:get_encerramento_organizacao": { area: "socio", motivo: "também é da gestão da academia, que avisa o próprio encerramento" },
  "rpc:avisar_encerramento_organizacao": { area: "socio", motivo: "também é da gestão da academia, que avisa o próprio encerramento" },
  "rpc:retirar_encerramento_organizacao": { area: "socio", motivo: "também é da gestão da academia, que avisa o próprio encerramento" },
  "fn:encerramento-organizacao": { area: "socio" },
  "from:plataforma_config": {
    area: "socio",
    motivo:
      "leitura e gravação direta: o RLS (20261433) é do Sócio, e abre a leitura das chaves de dinheiro ao Financeiro e a dos interruptores da Letícia ao Comercial",
  },
  "from:plataforma_textos": { area: "socio", motivo: TABELA },
  // Mentoria
  "rpc:get_superadmin_fila_mentor": { area: "mentoria" },
  "rpc:get_fila_mentor": { area: "mentoria" },
  "rpc:get_carteira_mentor": { area: "mentoria" },
  "rpc:get_ficha_mentor": { area: "mentoria" },
  "rpc:definir_metas_aluno_metodo": { area: "mentoria" },
  "rpc:criar_instrucao_presencial": { area: "mentoria" },
  "rpc:liberar_progressao_aluno": { area: "mentoria", motivo: DA_ACADEMIA },
  "rpc:mover_fase_jornada": { area: "mentoria", motivo: DA_ACADEMIA },
  "rpc:get_jornada_aluno": { area: "mentoria", motivo: DA_ACADEMIA },
  "rpc:publicar_treino": { area: "mentoria", motivo: "também é da academia: o RLS de treinos e o gatilho do dono decidem (CREF sempre exigido de quem não é Sócio)" },
  "rpc:publicar_treino_do_zero": { area: "mentoria", motivo: "também é da academia: confere pode_prescrever_treino_metodo() no aluno do Método, e o RLS de treinos e o gatilho do dono decidem (CREF sempre exigido de quem não é Sócio)" },
  "rpc:publicar_dieta": { area: "mentoria", motivo: "também é da academia: o RLS de dietas e o gatilho do dono decidem (CRN sempre exigido de quem não é Sócio)" },
  "fn:importar-dieta-pdf": { area: "mentoria", motivo: "também é da academia: a função pergunta equipe_metodo() ao banco com a sessão de quem chama" },
  "fn:mentor-sugerir-resposta": { area: "mentoria" },
  "fn:sentinela-anamnese": { area: "mentoria" },
  "rpc:atribuir_mentor_aluno": { area: "socio" },
  "rpc:get_superadmin_equipe_arkefit": { area: "socio" },
  "rpc:get_operacao_mentor": { area: "socio" },
  "rpc:get_carga_mentores": { area: "socio" },
  "from:mensagens_mentor": { area: "mentoria", motivo: TABELA },
  "from:sentinela_sugestoes": { area: "mentoria", motivo: TABELA },
  "from:sentinela_anamnese": { area: "mentoria", motivo: TABELA },
  "from:aluno_consentimento_ia": { area: "mentoria", motivo: TABELA },
  "from:aluno_fase_historico": { area: "mentoria", motivo: TABELA },
  "from:tarefas": { area: "mentoria", motivo: TABELA },
  "from:alunos": { area: "mentoria", motivo: TABELA },
  "from:dietas": { area: "mentoria", motivo: TABELA },
  "from:treinos": { area: "mentoria", motivo: TABELA },
  "from:anamnese_acolhimento": { area: "mentoria", motivo: TABELA },
  "from:modelos_treino": { area: "mentoria", motivo: TABELA },
  "from:modelo_treino_exercicios": { area: "mentoria", motivo: TABELA },
  "from:modelos_dieta": { area: "mentoria", motivo: TABELA },
  "from:modelo_dieta_refeicoes": { area: "mentoria", motivo: TABELA },
  "from:alimentos_biblioteca": { area: "mentoria", motivo: TABELA },
  "from:exercicios_biblioteca": { area: "mentoria", motivo: TABELA },
  "from:grupos_musculares": { area: "mentoria", motivo: TABELA },
  "from:equipamentos": { area: "mentoria", motivo: TABELA },
  "from:responsavel_aceites": { area: "mentoria", motivo: TABELA },
  "from:responsavel_pedidos": { area: "mentoria", motivo: TABELA },
  "rpc:informar_data_nascimento": { area: "mentoria", motivo: "do aluno menor: quem informa é a academia; a Visão Master só mostra" },
  "rpc:academia_tem_catraca": { area: "mentoria", motivo: "do aluno menor: diz se a academia tem catraca; também é da academia" },
  "fn:responsavel-pedido": { area: "mentoria", motivo: "do aluno menor: o pedido ao responsável é da academia" },
  // Equipe
  "rpc:salvar_equipe_arkefit": { area: "socio" },
  "fn:equipe-arkefit-convidar": { area: "socio" },
  // Comercial
  "from:leads_comerciais": { area: "comercial", motivo: TABELA },
  "rpc:acionar_agente_comercial": { area: "comercial" },
  "rpc:definir_agente_comercial": { area: "socio" },
  // Suporte e implantação
  "rpc:get_superadmin_assistente_numeros": { area: "suporte" },
  "rpc:get_superadmin_chamados_suporte": { area: "suporte" },
  "rpc:concluir_chamado_suporte": { area: "suporte" },
  "rpc:get_superadmin_avaliacoes_atendimento": { area: "suporte" },
  "rpc:get_superadmin_implantacoes": { area: "suporte" },
  "rpc:get_implantacao_organizacao": { area: "suporte", motivo: DA_ACADEMIA },
  "rpc:concluir_chamado_implantacao": { area: "suporte" },
  "rpc:definir_agente_implantacao": { area: "socio" },
  // Profissionais
  "rpc:get_superadmin_profissionais_autonomos": { area: "carteira" },
  "rpc:atualizar_profissional_autonomo": { area: "cadastro" },
  "fn:convidar-profissional-autonomo": { area: "cadastro" },
  "fn:gerar-link-ativacao": { area: "socio", motivo: "do Sócio: confere o papel superadmin, com as duas etapas" },
  // Operação
  "rpc:get_superadmin_equipamentos": { area: "operacao" },
  "rpc:get_superadmin_acessos_catraca": { area: "operacao" },
  "rpc:get_superadmin_biometria": { area: "operacao" },
  "rpc:get_superadmin_vigia": { area: "operacao" },
  "rpc:get_superadmin_rotinas": { area: "operacao" },
  "rpc:get_superadmin_capacidade": { area: "operacao" },
  "rpc:vigia_dispensar": { area: "socio" },
  "rpc:definir_modo_regra_vigia": { area: "socio" },
  "rpc:definir_vigia_ativo": { area: "socio" },
  "fn:vigia-aprovar": { area: "socio" },
  "rpc:solicitar_comando_gateway": { area: "socio", motivo: "também é da academia (a gestão e a recepção comandam a própria catraca)" },
  "from:gateway_telemetria": { area: "socio", motivo: TABELA },
  "from:gateway_eventos": { area: "socio", motivo: TABELA },
  "from:gateway_comandos": { area: "socio", motivo: TABELA },
  "from:reconciliacoes_asaas": { area: "financeiro", motivo: TABELA },
  "rpc:get_superadmin_webhooks_asaas": { area: "financeiro" },
  "rpc:get_superadmin_webhooks_asaas_resumo": { area: "financeiro" },
  // Sócio
  "rpc:get_superadmin_uso_ia": { area: "socio" },
  "from:auditoria_acoes_sensiveis": { area: "socio", motivo: TABELA },
  // A sessão de qualquer um
  "from:push_subscriptions": { area: "todos", motivo: "sair: esquece os avisos deste aparelho; e ligar os avisos do aparelho, embaixo da conversa" },
  "fn:vapid-public-key": { area: "todos", motivo: "a chave pública dos avisos no celular, de qualquer sessão" },
  "fn:send-chat-push": {
    area: "mentoria",
    motivo:
      "também é do aluno e da academia: no canal do mentor, a prova é a mensagem recém-gravada, lida com o RLS de quem chama (que pergunta acesso_arkefit('mentoria') no banco)",
  },
  "from:profiles": { area: "todos", motivo: TABELA },
};

// ── O estado da conta no caminho de entrada ────────────────────────────────

/**
 * Onde a conta está no caminho de entrada, como o banco calcula
 * (`estado_conta_arkefit()`, migration 20261421010000):
 *   - `convite_enviado`: a pessoa ainda não criou a senha pelo link;
 *   - `sem_duas_etapas`: criou a senha, mas não cadastrou o aplicativo
 *     autenticador. Até lá, a conta não tem nenhum poder da ArkeFit
 *     (`has_role` e `acesso_arkefit` exigem a sessão verificada);
 *   - `ativo`: senha e duas etapas.
 */
export type EstadoContaArkefit = "convite_enviado" | "sem_duas_etapas" | "ativo";

export const ROTULO_ESTADO: Record<EstadoContaArkefit, string> = {
  convite_enviado: "Convite enviado",
  sem_duas_etapas: "Sem as duas etapas",
  ativo: "Ativo",
};

export const EXPLICACAO_ESTADO: Record<EstadoContaArkefit, string> = {
  convite_enviado: "Ainda não criou a senha pelo link do e-mail.",
  sem_duas_etapas: "Criou a senha, mas ainda não cadastrou o aplicativo autenticador. Até lá, não tem nenhum acesso da ArkeFit.",
  ativo: "Senha e duas etapas configuradas.",
};

/** O estado que veio do banco; a tela publicada antes desta coluna não a recebe. */
export function estadoDaConta(valor: unknown): EstadoContaArkefit | null {
  return valor === "convite_enviado" || valor === "sem_duas_etapas" || valor === "ativo" ? valor : null;
}
