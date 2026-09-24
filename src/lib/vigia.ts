import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * O Vigia, o agente de saúde técnica, visto pela ArkeFit. Os dados vêm de
 * public.get_superadmin_vigia() — o mesmo resumo que vai no e-mail diário
 * (vigia-resumo), para a tela e o e-mail não discordarem.
 *
 * Os rótulos abaixo espelham o catálogo de supabase/functions/_shared/
 * vigiaAnalise.ts (o app não importa código das edge functions);
 * src/lib/vigia.test.ts falha se os dois se afastarem.
 */

export type Classe = "sozinho" | "aprovacao" | "humano";

export type RegraVigia = {
  codigo: string;
  nivel: number;
  titulo: string;
  acao: string;
  modo: string;
  deteccoes: number;
  teria_agido: number;
  com_retentativa: number;
  sumiram_antes: number;
  mediana_min_sumiram: number | null;
  persistiram: number;
  escalariam: number;
  freios: number;
  abertas: number;
};

export type OcorrenciaVigia = {
  id: number;
  regra: string;
  nivel: number;
  titulo: string;
  descricao: string;
  aberta_em: string;
  fechada_em: string | null;
  acao_prevista_em: string | null;
  tentativas_previstas: number;
  escalaria_em: string | null;
  freio_em: string | null;
};

export type AcaoVigia = {
  ferramenta: string;
  alvo: string;
  alvo_nome: string;
  justificativa: string;
  classe: Classe | null;
  recusada?: "fora_do_catalogo" | "alvo_inexistente" | "alvo_sem_sinal" | "freio_falha_geral";
};

export type AnaliseVigia = {
  id: number;
  criada_em: string;
  status: "ok" | "indisponivel" | "recusada_validacao" | "resposta_invalida";
  modelo: string | null;
  diagnostico: string | null;
  causa_provavel: string | null;
  gravidade: string | null;
  confianca: number | null;
  anomalias: number;
  latencia_ms: number | null;
  motivo: string | null;
  acoes: AcaoVigia[];
};

export type ResumoVigia = {
  ativo: boolean;
  sombra_desde: string;
  dia: number;
  dias_avaliacao: number;
  janela_horas: number;
  varreduras: number;
  regras: RegraVigia[];
  ocorrencias: OcorrenciaVigia[];
  analises: {
    total: number;
    ok: number;
    indisponiveis: number;
    recusadas: number;
    invalidas: number;
    acoes_sozinho: number;
    acoes_aprovacao: number;
    acoes_humano: number;
    acoes_recusadas: number;
    lista: AnaliseVigia[];
  };
  total: { deteccoes: number; teria_agido: number; sumiram_antes: number; escalariam: number; analises: number };
};

export const ROTULO_FERRAMENTA: Record<string, string> = {
  sincronizar_gateway: "Sincronizar o Gateway",
  reenviar_acessos_gateway: "Reenviar os acessos guardados",
  pedir_diagnostico_gateway: "Pedir diagnóstico ao Gateway",
  vencer_ordens_paradas: "Vencer ordens paradas",
  reenviar_remocao_digital: "Reenviar a remoção da digital",
  reexecutar_rotina: "Rodar a rotina de novo",
  reconferir_asaas: "Conferir o Asaas de novo",
  reprocessar_evento_asaas: "Reprocessar aviso do Asaas",
  cancelar_assinatura_orfa: "Cancelar assinatura órfã",
  reiniciar_gateway: "Reiniciar o Gateway",
  acionar_academia: "Falar com a academia",
  acionar_suporte_arkefit: "Investigar na plataforma",
};

export const ROTULO_CAUSA: Record<string, string> = {
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

export const ROTULO_RECUSA: Record<NonNullable<AcaoVigia["recusada"]>, string> = {
  fora_do_catalogo: "recusada: fora da lista de ferramentas",
  alvo_inexistente: "recusada: alvo que não está no quadro",
  alvo_sem_sinal: "recusada: Gateway sem sinal, a ordem não chegaria",
  freio_falha_geral: "segurada: a mesma ordem para muitos Gateways (freio de falha geral)",
};

export const ROTULO_STATUS_ANALISE: Record<AnaliseVigia["status"], string> = {
  ok: "concluída",
  indisponivel: "modelo indisponível",
  recusada_validacao: "quadro recusado pela validação",
  resposta_invalida: "resposta inválida",
};

export const JANELAS = [
  { horas: 24, rotulo: "Últimas 24 h" },
  { horas: 24 * 7, rotulo: "Últimos 7 dias" },
  { horas: 24 * 400, rotulo: "Desde o início" },
] as const;

/** O que aconteceu com uma ocorrência, em palavras — a pergunta da avaliação. */
export function desfechoOcorrencia(o: OcorrenciaVigia): { texto: string; tom: "neutro" | "atencao" | "problema" | "ok" } {
  if (o.freio_em && !o.acao_prevista_em) return { texto: "segurada pelo freio de falha geral", tom: "atencao" };
  if (o.escalaria_em) return { texto: "iria para uma pessoa", tom: "problema" };
  if (o.fechada_em && !o.acao_prevista_em) return { texto: "sumiu antes da hora de agir", tom: "ok" };
  if (o.acao_prevista_em) {
    const verbo = o.nivel === 1 ? "teria agido" : "teria pedido aprovação";
    const vezes = o.nivel === 1 && o.tentativas_previstas > 1 ? ` (${o.tentativas_previstas} tentativas)` : "";
    return { texto: `${verbo}${vezes}${o.fechada_em ? ", e resolveu" : ""}`, tom: o.fechada_em ? "ok" : "atencao" };
  }
  return { texto: "aguardando a hora de agir", tom: "neutro" };
}

export function periodoSombra(r: Pick<ResumoVigia, "dia" | "dias_avaliacao">): string {
  return r.dia > r.dias_avaliacao
    ? `Avaliação de ${r.dias_avaliacao} dias concluída — aguardando a decisão`
    : `Dia ${r.dia} de ${r.dias_avaliacao} da avaliação`;
}

export function useVigia(horas: number) {
  return useQuery({
    queryKey: ["vigia", horas],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_vigia", { _horas: horas });
      if (error) throw error;
      return data as unknown as ResumoVigia;
    },
    refetchInterval: 60_000,
  });
}
