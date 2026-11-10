import type { Enums } from "@/integrations/supabase/types";

type Prioridade = Enums<"tarefa_prioridade">;
type Status = Enums<"tarefa_status">;
type Tipo = Enums<"tarefa_tipo">;

/** Os nomes das tarefas da fila na tela: a fila, o histórico dela e a ficha do aluno. */
export const PRIORIDADE_LABEL: Record<Prioridade, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

export const STATUS_LABEL: Record<Status, string> = {
  aberta: "Aberta",
  em_andamento: "Em andamento",
  aguardando: "Aguardando",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const TIPO_LABEL: Record<Tipo, string> = {
  ativacao: "Ativação pendente",
  anamnese: "Nova anamnese (M.A.P.A.®)",
  dor: "Dor / desconforto",
  barreira: "Barreira de rotina",
  ajuste: "Pedido de ajuste",
  outro: "Outro",
  cobranca: "Mensalidade atrasada",
  acolhimento_elite: "Acolhimento expandido (Elite)",
  engajamento_baixo: "Engajamento baixo no mês",
  atestado: "Atestado médico",
  inercia: "Risco de evasão (sem sinal de vida)",
  ciclo_travado: "Ciclo travado sem constância",
  instrucao_presencial: "Acolhimento presencial pedido pelo Mentor",
  equipamento: "Apagar aluno da catraca (LGPD)",
  avaliacao_baixa: "Avaliação baixa do aluno",
};
