import { supabase } from "@/integrations/supabase/client";

/**
 * O Gateway Local visto pelo painel: situação, ordens e o que cada uma quer
 * dizer para quem está na recepção.
 *
 * `situacaoGateway` é o espelho de `public.situacao_gateway()` — a mesma
 * regra no banco (Visão Master, alerta por e-mail) e aqui (tela da
 * academia), para as duas telas nunca discordarem sobre a mesma catraca.
 * Mudou lá, muda aqui; o teste confere os limites.
 */

export type SituacaoGateway = "online" | "contingencia" | "offline" | "nunca_conectou" | "desativada";

/** Gateway 1.0 reporta a cada ~20 s; três minutos sem notícia é queda. */
const LIMITE_TELEMETRIA_MS = 3 * 60_000;
/** Gateway anterior só dava sinal na sincronização de 5 em 5 minutos. */
const LIMITE_HEARTBEAT_MS = 15 * 60_000;

export function situacaoGateway(
  heartbeat: string | null | undefined,
  reportado: string | null | undefined,
  estado: string | null | undefined,
  agora: Date = new Date()
): SituacaoGateway {
  if (reportado) {
    if (agora.getTime() - new Date(reportado).getTime() > LIMITE_TELEMETRIA_MS) return "offline";
    return estado === "contingencia" ? "contingencia" : "online";
  }
  if (!heartbeat) return "nunca_conectou";
  return agora.getTime() - new Date(heartbeat).getTime() > LIMITE_HEARTBEAT_MS ? "offline" : "online";
}

export const SITUACAO_GATEWAY: Record<
  SituacaoGateway,
  { rotulo: string; descricao: string; tom: "ok" | "atencao" | "problema" | "neutro" }
> = {
  online: { rotulo: "No ar", descricao: "O Gateway fala com a nuvem normalmente.", tom: "ok" },
  contingencia: {
    rotulo: "Contingência",
    descricao:
      "A internet da academia está falhando: a catraca decide pelo cadastro guardado no computador, e os acessos sobem quando a conexão voltar.",
    tom: "atencao",
  },
  offline: {
    rotulo: "Sem sinal",
    descricao: "O computador do Gateway está desligado, sem internet ou com o programa parado.",
    tom: "problema",
  },
  nunca_conectou: {
    rotulo: "Nunca conectou",
    descricao: "Instale o Gateway Local no computador da recepção e cole o token deste dispositivo no config.json.",
    tom: "neutro",
  },
  desativada: { rotulo: "Desativada", descricao: "Desativada no ARKE: não recebe ordens.", tom: "neutro" },
};

export type TipoComando =
  | "sincronizar_completo"
  | "enviar_logs"
  | "diagnostico"
  | "liberar_catraca"
  | "cadastrar_usuario"
  | "cadastrar_digital"
  | "cadastrar_cartao"
  | "apagar_usuario";

export const ROTULO_COMANDO: Record<TipoComando, string> = {
  sincronizar_completo: "Sincronizar alunos",
  enviar_logs: "Enviar acessos guardados",
  diagnostico: "Diagnóstico",
  liberar_catraca: "Liberar catraca",
  cadastrar_usuario: "Cadastrar aluno no equipamento",
  cadastrar_digital: "Cadastrar digital",
  cadastrar_cartao: "Cadastrar cartão",
  apagar_usuario: "Apagar do equipamento",
};

export type StatusComando = "pendente" | "entregue" | "concluido" | "falhou" | "expirado";

export const ROTULO_STATUS_COMANDO: Record<StatusComando, string> = {
  pendente: "Aguardando o Gateway",
  entregue: "Em execução no Gateway",
  concluido: "Concluído",
  falhou: "Falhou",
  expirado: "Expirou sem resposta",
};

export const comandoTerminou = (status: string) => status === "concluido" || status === "falhou" || status === "expirado";

export type Comando = {
  id: string;
  tipo: string;
  status: StatusComando;
  resultado: Record<string, unknown> | null;
  erro: string | null;
  solicitado_em: string;
  concluido_em: string | null;
};

/** Pede uma ordem ao Gateway. A permissão e a capacidade são conferidas no banco. */
export async function solicitarComando(
  catracaId: string,
  tipo: TipoComando,
  opcoes: { parametros?: Record<string, unknown>; alunoId?: string | null; motivo?: string | null } = {}
): Promise<string> {
  const { data, error } = await supabase.rpc("solicitar_comando_gateway", {
    _catraca_id: catracaId,
    _tipo: tipo,
    _parametros: (opcoes.parametros ?? {}) as never,
    _aluno_id: opcoes.alunoId ?? undefined,
    _motivo: opcoes.motivo ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Acompanha a ordem até o fim. O Gateway recebe em ~1 s e responde assim que
 * termina — o cadastro de digital pode levar até um minuto e meio, porque o
 * aluno põe o dedo três vezes.
 */
export async function aguardarComando(
  id: string,
  { intervaloMs = 1_500, limiteMs = 150_000, aoMudar }: { intervaloMs?: number; limiteMs?: number; aoMudar?: (c: Comando) => void } = {}
): Promise<Comando> {
  const fim = Date.now() + limiteMs;
  let ultimo = "";
  for (;;) {
    const { data, error } = await supabase
      .from("gateway_comandos")
      .select("id, tipo, status, resultado, erro, solicitado_em, concluido_em")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Ordem não encontrada.");
    const c = data as Comando;
    if (c.status !== ultimo) {
      ultimo = c.status;
      aoMudar?.(c);
    }
    if (comandoTerminou(c.status)) return c;
    if (Date.now() > fim) return c;
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * O resultado de uma ordem em uma frase, para quem está na recepção. Falha
 * na cópia para outra catraca aparece junto: o cadastro deu certo, mas o
 * aluno não vai entrar pela catraca que não recebeu a digital.
 */
export function resumoResultado(tipo: string, resultado: Record<string, unknown> | null | undefined): string {
  const r = resultado ?? {};
  const falhas = Array.isArray(r.falhou_em)
    ? (r.falhou_em as { equipamento?: string }[]).map((f) => f?.equipamento).filter(Boolean)
    : [];
  const copias = lista(r.replicado_em);
  const aviso = falhas.length ? ` Não foi possível copiar para: ${falhas.join(", ")} — repita o cadastro.` : "";
  const copia = copias.length ? ` e copiada para ${copias.join(", ")}` : "";
  switch (tipo) {
    case "cadastrar_usuario":
      return `Aluno cadastrado em ${lista(r.equipamentos).join(", ") || "todos os equipamentos"}.`;
    case "cadastrar_digital":
      return `Digital cadastrada em ${String(r.equipamento ?? "equipamento")}${copia}.${aviso}`;
    case "cadastrar_cartao":
      return `Cartão cadastrado em ${String(r.equipamento ?? "equipamento")}${copia.replace("copiada", "copiado")}.${aviso}`;
    case "liberar_catraca":
      return `Catraca liberada em ${String(r.equipamento ?? "equipamento")}.`;
    case "apagar_usuario":
      return `Aluno apagado de ${lista(r.equipamentos).join(", ") || "todos os equipamentos"}.`;
    case "sincronizar_completo":
      return `Cadastro do Gateway atualizado: ${Number(r.total ?? 0)} aluno(s).`;
    case "enviar_logs":
      return Number(r.enviados ?? 0) > 0 ? `${Number(r.enviados)} acesso(s) guardado(s) enviados à nuvem.` : "Não havia acesso guardado para enviar.";
    case "diagnostico":
      return `Gateway ${String(r.versao ?? "?")} · ${String(r.status ?? "?")} · fila offline ${Number(r.filaOffline ?? 0)} · cadastro com ${Number(r.cacheAlunos ?? 0)} aluno(s).`;
    default:
      return "Concluído.";
  }
}

/** "há 3 min", "há 2 h", "há 4 dias" — para o painel, onde a hora exata importa menos que a distância. */
export function tempoDesde(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "nunca";
  const seg = Math.max(0, Math.round((agora.getTime() - new Date(iso).getTime()) / 1000));
  if (seg < 60) return "agora";
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/** Equipamentos com gestão remota que o Gateway anunciou na telemetria (nomes do config). */
export function equipamentosDeGestao(equipamentos: unknown): string[] {
  if (!Array.isArray(equipamentos)) return [];
  return equipamentos
    .filter((e): e is { nome: string; tipo: string } => !!e && typeof e === "object" && (e as { tipo?: unknown }).tipo === "controlid-gestao")
    .map((e) => String(e.nome));
}
