import type { Tables } from "@/integrations/supabase/types";
import { PRIORIDADE_LABEL, STATUS_LABEL, TIPO_LABEL } from "@/lib/rotulosTarefa";

type Tarefa = Tables<"tarefas">;

/**
 * Tudo de um chamado da fila: o que era, quando abriu, o prazo, se escalou,
 * o aviso ao aluno, o agendamento, quem tratou, quando encerrou, a ação e o
 * desfecho. Usado no histórico da fila e no histórico da ficha do aluno.
 */
export function DetalheDaTarefa({ tarefa, aluno, responsavel }: { tarefa: Tarefa; aluno?: string | null; responsavel: string | null }) {
  const encerrada = tarefa.status === "concluida" || tarefa.status === "cancelada";
  const quando = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : null);
  const linhas: [string, string | null | undefined][] = [
    ["Tipo", TIPO_LABEL[tarefa.tipo]],
    ["Aluno", aluno],
    ["Situação", STATUS_LABEL[tarefa.status]],
    ["Prioridade", PRIORIDADE_LABEL[tarefa.prioridade]],
    ["Aberta em", quando(tarefa.created_at)],
    ["Prazo", quando(tarefa.sla_prazo)],
    ["Escalada em", quando(tarefa.escalada_em)],
    ["Aviso ao aluno", quando(tarefa.aviso_automatico_em)],
    ["Agendada para", quando(tarefa.data_agendada)],
    ["Encerrada em", encerrada ? quando(tarefa.concluida_em ?? tarefa.updated_at) : null],
    ["Responsável", responsavel ?? "Sem responsável"],
    ["Ação", tarefa.acao],
    ["Desfecho", encerrada ? tarefa.desfecho_acao || "Sem desfecho registrado" : "Ainda aberta"],
  ];
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {linhas
        .filter(([, valor]) => !!valor)
        .map(([rotulo, valor]) => (
          <div key={rotulo} className="contents">
            <dt className="text-muted-foreground">{rotulo}</dt>
            <dd className="whitespace-pre-wrap min-w-0">{valor}</dd>
          </div>
        ))}
    </dl>
  );
}
